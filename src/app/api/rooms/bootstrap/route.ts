import { NextResponse } from "next/server";

import { resolveRoomVoiceRuntimeForOwner } from "@/features/transcription/core/runtime";
import { requireApiUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  createOwnedRoom,
  ensureRoomParticipant,
  findRoomByRoomId,
  normalizeRoomId,
} from "@/lib/room-utils";

export const runtime = "nodejs";

type BootstrapRequest =
  | {
      action: "create";
    }
  | {
      action: "join";
      roomId: string;
    };

export async function POST(request: Request) {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const body = (await request.json()) as BootstrapRequest;
    if (body?.action !== "create" && body?.action !== "join") {
      return NextResponse.json({ error: "action must be create or join" }, { status: 400 });
    }

    const room =
      body.action === "create"
        ? await createOwnedRoom(user.id)
        : await (async () => {
            const roomId = normalizeRoomId((body as { roomId?: string }).roomId);
            if (!roomId) {
              throw new Error("roomId is required for join action");
            }

            const existing = await findRoomByRoomId(roomId);
            if (!existing) {
              throw new Error("room not found");
            }
            await ensureRoomParticipant(existing.id, user.id);
            return existing;
          })();

    if (body.action === "create") {
      await ensureRoomParticipant(room.id, user.id);
    }

    const voiceRuntime = await resolveRoomVoiceRuntimeForOwner(room.createdById);

    await prisma.roomParticipant.updateMany({
      where: {
        roomRefId: room.id,
        userId: user.id,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });

    return NextResponse.json({
      roomId: room.roomId,
      status: room.status,
      endedAt: room.endedAt?.toISOString() ?? null,
      isCreator: room.createdById === user.id,
      voiceRuntime: {
        ready: voiceRuntime.ready,
        source: voiceRuntime.source,
        transcriberEnabled: voiceRuntime.transcriberEnabled,
        transport: {
          provider: "livekit",
          source: voiceRuntime.livekit.source,
          credentialMask: voiceRuntime.livekit.livekitApiKeyMask,
          ready: voiceRuntime.livekit.configured,
        },
        transcription: voiceRuntime.transcription
          ? {
              provider: voiceRuntime.transcription.provider,
              source: voiceRuntime.transcription.source,
              credentialMask: voiceRuntime.transcription.credentialMask,
              ready: voiceRuntime.transcription.configured,
            }
          : null,
        error: voiceRuntime.error,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to bootstrap room";
    const status = message === "room not found" ? 404 : message.includes("roomId") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
