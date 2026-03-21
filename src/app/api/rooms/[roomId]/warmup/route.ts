import { RoomStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  isTranscriberEnabled,
  resolveRoomVoiceRuntimeForOwner,
} from "@/features/transcription/core/runtime";
import { appendTranscriberRuntimeLog } from "@/features/transcription/runtime/runtime-log";
import { ensureTranscriberWorker } from "@/features/transcription/runtime/worker-manager";
import { requireApiUser } from "@/lib/auth-guard";
import { assertRoomUserCanParticipate } from "@/lib/room-members";
import { assertRoomOwnerActiveOrThrow } from "@/lib/room-presence";
import { RoomAccessError, getAccessibleRoomOrThrow } from "@/lib/rooms";
import { normalizeRoomId } from "@/lib/room-utils";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const { roomId: rawRoomId } = await context.params;
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) {
      return NextResponse.json({ error: "roomId is required" }, { status: 400 });
    }

    const room = await getAccessibleRoomOrThrow(roomId, user.id);
    appendTranscriberRuntimeLog("transcriber-warmup-route", "warmup-request", {
      roomId,
      userId: user.id,
    });
    if (room.status === RoomStatus.ENDED) {
      return NextResponse.json({ ok: true, skipped: "room-ended" });
    }
    await assertRoomOwnerActiveOrThrow(room, user.id);
    await assertRoomUserCanParticipate(room.id, room.createdById, user.id);

    if (!isTranscriberEnabled()) {
      return NextResponse.json({ ok: true, skipped: "transcriber-disabled" });
    }

    const voiceRuntime = await resolveRoomVoiceRuntimeForOwner(room.createdById);
    if (!voiceRuntime.ready || !voiceRuntime.transcription) {
      return NextResponse.json(
        {
          error: voiceRuntime.error ?? "Voice runtime is unavailable",
        },
        { status: 400 },
      );
    }

    const worker = await ensureTranscriberWorker(
      {
        livekitUrl: voiceRuntime.livekit.livekitUrl!,
        livekitApiKey: voiceRuntime.livekit.livekitApiKey!,
        livekitApiSecret: voiceRuntime.livekit.livekitApiSecret!,
      },
      {
        waitForReady: true,
        reason: `warmup:${room.roomId}`,
      },
    );
    appendTranscriberRuntimeLog("transcriber-warmup-route", "warmup-result", {
      roomId,
      userId: user.id,
      worker,
    });

    return NextResponse.json({
      ok: true,
      worker,
    });
  } catch (error) {
    if (error instanceof RoomAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to warm up transcriber worker";
    appendTranscriberRuntimeLog("transcriber-warmup-route", "warmup-failed", {
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
