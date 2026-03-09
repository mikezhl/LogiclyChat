import { RoomStatus } from "@prisma/client";
import { AccessToken } from "livekit-server-sdk";
import { NextResponse } from "next/server";

import { ensureConversationAnalysisWorker } from "@/features/analysis/runtime/worker-manager";
import {
  ensureTranscriberDispatch,
  isTranscriberEnabled,
} from "@/features/transcription/service/livekit-dispatch";
import { ensureTranscriberWorker } from "@/features/transcription/runtime/worker-manager";
import { requireApiUser } from "@/lib/auth-guard";
import { optionalEnv } from "@/lib/env";
import { resolveConversationLlmRuntimeForOwner } from "@/lib/llm-provider-keys";
import { buildRoomProviderModules } from "@/lib/provider-modules";
import { resolveProviderCredentialsForOwner } from "@/lib/provider-keys";
import { prisma } from "@/lib/prisma";
import { RoomAccessError, getAccessibleRoomOrThrow } from "@/lib/rooms";
import { normalizeRoomId } from "@/lib/room-utils";

export const runtime = "nodejs";

type TokenRequest = {
  roomId?: string;
  connectionMode?: "data" | "voice";
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

    if (!roomId) {
      return NextResponse.json({ error: "roomId is required" }, { status: 400 });
    }

    const room = await getAccessibleRoomOrThrow(roomId, user.id);
    if (room.status === RoomStatus.ENDED) {
      return NextResponse.json({ error: "room has ended and voice is unavailable" }, { status: 403 });
    }
    const owner = room.createdById
      ? await prisma.user.findUnique({
          where: { id: room.createdById },
          select: { username: true },
        })
      : null;

    const [credentials, llmRuntime] = await Promise.all([
      resolveProviderCredentialsForOwner(room.createdById),
      resolveConversationLlmRuntimeForOwner(room.createdById),
    ]);
    if (!credentials.livekitUrl || !credentials.livekitApiKey || !credentials.livekitApiSecret) {
      const mode = optionalEnv("USER_PROVIDER_KEYS_MODE") ?? "true";
      return NextResponse.json(
        {
          error:
            mode === "full"
              ? "USER_PROVIDER_KEYS_MODE=full requires room creator to configure LiveKit URL/API key/secret"
              : "LiveKit credentials are unavailable",
        },
        { status: 400 },
      );
    }

    const transcriberEnabled = isTranscriberEnabled();
    if (isVoiceMode && transcriberEnabled && !credentials.deepgramApiKey) {
      const mode = optionalEnv("USER_PROVIDER_KEYS_MODE") ?? "true";
      return NextResponse.json(
        {
          error:
            mode === "full"
              ? "USER_PROVIDER_KEYS_MODE=full requires room creator to configure Deepgram API key"
              : "Deepgram API key is unavailable for transcription",
        },
        { status: 400 },
      );
    }

    if (isVoiceMode && transcriberEnabled) {
      await ensureTranscriberWorker(
        {
          livekitUrl: credentials.livekitUrl,
          livekitApiKey: credentials.livekitApiKey,
          livekitApiSecret: credentials.livekitApiSecret,
        },
        {
          waitForReady: true,
          reason: `join-voice:${roomId}`,
        },
      );
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
        const dispatchResult = await ensureTranscriberDispatch(roomId, {
          livekitUrl: credentials.livekitUrl,
          livekitApiKey: credentials.livekitApiKey,
          livekitApiSecret: credentials.livekitApiSecret,
        });
        console.info("Token route transcriber dispatch result:", {
          roomId,
          dispatchResult,
        });
      } catch (dispatchError) {
        console.error("Token route failed to dispatch transcriber agent:", {
          roomId,
          error: dispatchError instanceof Error ? dispatchError.message : dispatchError,
        });
      }
    }

    const identity = `user-${user.id}`;
    const accessToken = new AccessToken(credentials.livekitApiKey, credentials.livekitApiSecret, {
      identity,
      name: user.username,
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
    const providers = buildRoomProviderModules(credentials, llmRuntime, owner?.username ?? null);

    return NextResponse.json({
      token,
      livekitUrl: credentials.livekitUrl,
      identity,
      displayName: user.username,
      transcriberEnabled: isVoiceMode ? transcriberEnabled : false,
      connectionMode,
      providers,
    });
  } catch (error) {
    if (error instanceof RoomAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
