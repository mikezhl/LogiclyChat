import { NextResponse } from "next/server";

import { resolveRoomVoiceRuntimeForOwner } from "@/features/transcription/core/runtime";
import { releaseTranscriberDispatchIfIdle } from "@/features/transcription/service/livekit-dispatch";
import { requireApiUser } from "@/lib/auth-guard";
import { RoomAccessError, getAccessibleRoomOrThrow } from "@/lib/rooms";
import { normalizeRoomId } from "@/lib/room-utils";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

type ReleaseVoiceRuntimeRequest = {
  participantIdentity?: string;
};

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
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
    const body = (await request.json().catch(() => ({}))) as ReleaseVoiceRuntimeRequest;
    const voiceRuntime = await resolveRoomVoiceRuntimeForOwner(room.createdById);

    if (!voiceRuntime.livekit.livekitUrl || !voiceRuntime.livekit.livekitApiKey || !voiceRuntime.livekit.livekitApiSecret) {
      return NextResponse.json({ error: voiceRuntime.error ?? "LiveKit credentials are unavailable" }, { status: 400 });
    }

    const result = await releaseTranscriberDispatchIfIdle(roomId, {
      credentials: {
        livekitUrl: voiceRuntime.livekit.livekitUrl,
        livekitApiKey: voiceRuntime.livekit.livekitApiKey,
        livekitApiSecret: voiceRuntime.livekit.livekitApiSecret,
      },
      ignoredParticipantIdentity: body.participantIdentity,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RoomAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to release voice runtime";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
