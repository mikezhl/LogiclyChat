import { MessageType } from "@prisma/client";
import { NextResponse } from "next/server";

import { enqueueRealtimeAnalysisEvent } from "@/features/analysis/service/analysis-events";
import {
  formatCompactAnalysisError,
  getAnalysisSchemaFixHint,
  isAnalysisSchemaMissingError,
} from "@/features/analysis/service/analysis-errors";
import { ensureConversationAnalysisWorker } from "@/features/analysis/runtime/worker-manager";
import { requireApiUser } from "@/lib/auth-guard";
import { ChatMessage } from "@/lib/chat-types";
import { MESSAGE_PAGE_SIZE } from "@/lib/constants";
import { isRoomSpeakerSwitchEnabled } from "@/lib/env";
import { resolveRoomVoiceRuntimeForOwner } from "@/features/transcription/core/runtime";
import { createRoomServiceClient, publishChatMessageViaLivekit } from "@/lib/livekit-chat-relay";
import { toChatMessage } from "@/lib/messages";
import { assertRoomUserCanParticipate } from "@/lib/room-members";
import { prisma } from "@/lib/prisma";
import { assertRoomOwnerActiveOrThrow } from "@/lib/room-presence";
import { RoomAccessError, assertRoomNotEnded, getAccessibleRoomOrThrow } from "@/lib/rooms";
import { buildRoomSpeakerProfile, resolveRoomSpeakerMode } from "@/lib/room-speaker";
import { normalizeRoomId } from "@/lib/room-utils";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

type PostMessageRequest = {
  content?: string;
  speakerMode?: string;
};

async function relayMessageToRoom(roomId: string, ownerUserId: string | null, message: ChatMessage) {
  const voiceRuntime = await resolveRoomVoiceRuntimeForOwner(ownerUserId);
  const credentials = voiceRuntime.livekit;
  if (!credentials.livekitUrl || !credentials.livekitApiKey || !credentials.livekitApiSecret) {
    return;
  }

  const roomServiceClient = createRoomServiceClient({
    livekitUrl: credentials.livekitUrl,
    livekitApiKey: credentials.livekitApiKey,
    livekitApiSecret: credentials.livekitApiSecret,
  });

  await publishChatMessageViaLivekit(roomServiceClient, roomId, message);
}

export async function GET(request: Request, context: RouteContext) {
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

    const { searchParams } = new URL(request.url);
    const since = searchParams.get("since");
    const sinceDate = since ? new Date(since) : undefined;
    const hasValidSince = Boolean(sinceDate && !Number.isNaN(sinceDate.getTime()));

    const messages = await prisma.message.findMany({
      where: {
        roomRefId: room.id,
        ...(hasValidSince && sinceDate
          ? {
              createdAt: {
                gt: sinceDate,
              },
            }
          : {}),
      },
      orderBy: {
        createdAt: "asc",
      },
      ...(hasValidSince ? { take: MESSAGE_PAGE_SIZE } : {}),
    });

    return NextResponse.json({
      messages: messages.map(toChatMessage),
    });
  } catch (error) {
    if (error instanceof RoomAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to fetch messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    const body = (await request.json()) as PostMessageRequest;
    const content = body?.content?.trim();
    const speakerMode = resolveRoomSpeakerMode(body?.speakerMode);

    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    if (speakerMode === "bot" && !isRoomSpeakerSwitchEnabled()) {
      return NextResponse.json({ error: "room speaker switch is disabled" }, { status: 403 });
    }

    const room = await getAccessibleRoomOrThrow(roomId, user.id);
    assertRoomNotEnded(room.status);
    await assertRoomOwnerActiveOrThrow(room, user.id);
    await assertRoomUserCanParticipate(room.id, room.createdById, user.id);
    const speakerProfile = buildRoomSpeakerProfile({
      userId: user.id,
      username: user.username,
      mode: speakerMode,
    });

    const message = await prisma.message.create({
      data: {
        roomRefId: room.id,
        type: MessageType.TEXT,
        senderName: speakerProfile.displayName,
        senderUserId: speakerProfile.senderUserId,
        participantId: speakerProfile.participantIdentity,
        content,
      },
    });
    const chatMessage = toChatMessage(message);

    void ensureConversationAnalysisWorker({
      waitForReady: false,
      reason: `text-message:${roomId}`,
    }).catch((workerError) => {
      console.warn("Failed to ensure conversation analysis worker", {
        roomId,
        messageId: chatMessage.id,
        error: workerError instanceof Error ? workerError.message : workerError,
      });
    });

    try {
      await enqueueRealtimeAnalysisEvent(room.id, message.id);
    } catch (enqueueError) {
      if (isAnalysisSchemaMissingError(enqueueError)) {
        console.warn("Analysis queue unavailable while enqueuing text message", {
          roomId,
          messageId: chatMessage.id,
          hint: getAnalysisSchemaFixHint(),
          error: formatCompactAnalysisError(enqueueError),
        });
      } else {
        console.warn("Failed to enqueue realtime analysis event", {
          roomId,
          messageId: chatMessage.id,
          error: formatCompactAnalysisError(enqueueError),
        });
      }
    }

    try {
      await relayMessageToRoom(roomId, room.createdById, chatMessage);
    } catch (relayError) {
      console.warn("Failed to relay text message through LiveKit data channel", {
        roomId,
        messageId: chatMessage.id,
        error: relayError instanceof Error ? relayError.message : relayError,
      });
    }

    return NextResponse.json({
      message: chatMessage,
    });
  } catch (error) {
    if (error instanceof RoomAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to send message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
