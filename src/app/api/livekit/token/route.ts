import { RoomStatus } from "@prisma/client";
import { AccessToken } from "livekit-server-sdk";
import { NextResponse } from "next/server";

import { ensureConversationAnalysisWorker } from "@/features/analysis/runtime/worker-manager";
import {
  isTranscriberEnabled,
  resolveRoomVoiceRuntimeForOwner,
} from "@/features/transcription/core/runtime";
import { appendTranscriberRuntimeLog } from "@/features/transcription/runtime/runtime-log";
import { ensureTranscriberDispatch } from "@/features/transcription/service/livekit-dispatch";
import { ensureTranscriberWorker } from "@/features/transcription/runtime/worker-manager";
import { requireApiUser } from "@/lib/auth-guard";
import { isRoomSpeakerSwitchEnabled } from "@/lib/env";
import { resolveConversationLlmRuntimeForOwner } from "@/lib/llm-provider-keys";
import { buildRoomProviderModules } from "@/lib/provider-modules";
import { prisma } from "@/lib/prisma";
import { assertRoomOwnerActiveOrThrow } from "@/lib/room-presence";
import { RoomAccessError, getAccessibleRoomOrThrow } from "@/lib/rooms";
import { buildRoomSpeakerProfile, resolveRoomSpeakerMode } from "@/lib/room-speaker";
import { normalizeRoomId } from "@/lib/room-utils";

export const runtime = "nodejs";

type TokenRequest = {
  roomId?: string;
  connectionMode?: "data" | "voice";
  speakerMode?: string;
};

export async function POST(request: Request) {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const body = (await request.json()) as TokenRequest;
    const roomId = normalizeRoomId(body?.roomId);
    const connectionMode = body?.connectionMode === "data" ? "data" : "voice";
    const isVoiceMode = connectionMode === "voice";
    const speakerMode = resolveRoomSpeakerMode(body?.speakerMode);

    if (!roomId) {
      return NextResponse.json({ error: "roomId is required" }, { status: 400 });
    }

    if (speakerMode === "bot" && !isRoomSpeakerSwitchEnabled()) {
      return NextResponse.json({ error: "room speaker switch is disabled" }, { status: 403 });
    }

    const room = await getAccessibleRoomOrThrow(roomId, user.id);
    if (room.status === RoomStatus.ENDED) {
      return NextResponse.json({ error: "room has ended and voice is unavailable" }, { status: 403 });
    }
    await assertRoomOwnerActiveOrThrow(room, user.id);

    const owner = room.createdById
      ? await prisma.user.findUnique({
          where: { id: room.createdById },
          select: { username: true },
        })
      : null;

    const [voiceRuntime, llmRuntime] = await Promise.all([
      resolveRoomVoiceRuntimeForOwner(room.createdById),
      resolveConversationLlmRuntimeForOwner(room.createdById),
    ]);
    appendTranscriberRuntimeLog("transcriber-token-route", "resolved-room-runtime", {
      roomId,
      userId: user.id,
      connectionMode,
      speakerMode,
      roomVoiceReady: voiceRuntime.ready,
      roomVoiceSource: voiceRuntime.source,
      transcriberEnabled: voiceRuntime.transcriberEnabled,
      livekitSource: voiceRuntime.livekit.source,
      transcriptionProvider: voiceRuntime.transcription?.provider ?? null,
      transcriptionSource: voiceRuntime.transcription?.source ?? null,
      runtimeError: voiceRuntime.error,
    });
    const livekitCredentials = voiceRuntime.livekit;
    if (!livekitCredentials.livekitUrl || !livekitCredentials.livekitApiKey || !livekitCredentials.livekitApiSecret) {
      return NextResponse.json(
        {
          error: voiceRuntime.error ?? "LiveKit credentials are unavailable",
        },
        { status: 400 },
      );
    }

    const transcriberEnabled = isTranscriberEnabled();
    if (transcriberEnabled && !voiceRuntime.ready) {
      return NextResponse.json(
        {
          error: voiceRuntime.error ?? "Voice runtime is unavailable",
        },
        { status: 400 },
      );
    }

    if (isVoiceMode && transcriberEnabled) {
      const worker = await ensureTranscriberWorker(
        {
          livekitUrl: voiceRuntime.livekit.livekitUrl!,
          livekitApiKey: voiceRuntime.livekit.livekitApiKey!,
          livekitApiSecret: voiceRuntime.livekit.livekitApiSecret!,
        },
        {
          waitForReady: true,
          reason: `join-voice:${roomId}`,
        },
      );
      appendTranscriberRuntimeLog("transcriber-token-route", "ensured-transcriber-worker", {
        roomId,
        userId: user.id,
        worker,
      });
    }

    void ensureConversationAnalysisWorker({
      waitForReady: false,
      reason: `${connectionMode}-token:${roomId}`,
    }).catch((workerError) => {
      console.warn("Failed to ensure conversation analysis worker", {
        roomId,
        error: workerError instanceof Error ? workerError.message : workerError,
      });
    });

    await prisma.roomParticipant.upsert({
      where: {
        roomRefId_userId: {
          roomRefId: room.id,
          userId: user.id,
        },
      },
      update: {
        lastSeenAt: new Date(),
      },
      create: {
        roomRefId: room.id,
        userId: user.id,
      },
    });

    if (isVoiceMode && transcriberEnabled) {
      try {
        const dispatch = await ensureTranscriberDispatch(roomId, {
          livekitUrl: voiceRuntime.livekit.livekitUrl!,
          livekitApiKey: voiceRuntime.livekit.livekitApiKey!,
          livekitApiSecret: voiceRuntime.livekit.livekitApiSecret!,
        });
        appendTranscriberRuntimeLog("transcriber-token-route", "ensured-transcriber-dispatch", {
          roomId,
          userId: user.id,
          dispatch,
        });
      } catch (dispatchError) {
        appendTranscriberRuntimeLog("transcriber-token-route", "ensure-transcriber-dispatch-failed", {
          roomId,
          userId: user.id,
          error: dispatchError instanceof Error ? dispatchError.message : dispatchError,
        });
        console.error("Token route failed to dispatch transcriber agent:", {
          roomId,
          error: dispatchError instanceof Error ? dispatchError.message : dispatchError,
        });
      }
    }

    const speakerProfile = buildRoomSpeakerProfile({
      userId: user.id,
      username: user.username,
      mode: speakerMode,
    });
    const accessToken = new AccessToken(livekitCredentials.livekitApiKey, livekitCredentials.livekitApiSecret, {
      identity: speakerProfile.participantIdentity,
      name: speakerProfile.displayName,
      ttl: "4h",
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await accessToken.toJwt();
    const providers = buildRoomProviderModules(voiceRuntime, llmRuntime, owner?.username ?? null);
    appendTranscriberRuntimeLog("transcriber-token-route", "issued-livekit-token", {
      roomId,
      userId: user.id,
      identity: speakerProfile.participantIdentity,
      connectionMode,
      transcriberEnabled: voiceRuntime.transcriberEnabled,
    });

    return NextResponse.json({
      token,
      livekitUrl: livekitCredentials.livekitUrl,
      identity: speakerProfile.participantIdentity,
      displayName: speakerProfile.displayName,
      transcriberEnabled: voiceRuntime.transcriberEnabled,
      connectionMode,
      providers,
    });
  } catch (error) {
    if (error instanceof RoomAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create token";
    appendTranscriberRuntimeLog("transcriber-token-route", "token-route-failed", {
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
