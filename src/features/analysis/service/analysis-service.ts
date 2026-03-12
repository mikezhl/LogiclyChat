import { MessageType, RoomStatus } from "@prisma/client";

import { invokeConversationSummary, invokeRealtimeConversationAnalysis } from "@/features/analysis/llm/core";
import { resolveRoomVoiceRuntimeForOwner } from "@/features/transcription/core/runtime";
import { createRoomServiceClient, publishChatMessageViaLivekit } from "@/lib/livekit-chat-relay";
import { toChatMessage } from "@/lib/messages";
import { getRoomNameFromAnalysisPayload } from "@/lib/room-name";
import { prisma } from "@/lib/prisma";
import { recordLlmUsageForOwner } from "@/lib/usage-stats";
import { compactConversationForAnalysis } from "./dialogue-compact";

const REALTIME_ANALYSIS_SENDER = "AI Analyst";
const FINAL_SUMMARY_SENDER = "AI Summary";
const DEFAULT_HISTORY_TURN_LIMIT = 18;

export type AnalysisExecutionResult = {
  executed: boolean;
  reason?: string;
  messageId?: string;
};

function isRelayRoomMissingError(error: unknown) {
  if (error instanceof Error) {
    return error.message.toLowerCase().includes("requested room does not exist");
  }

  return typeof error === "string" && error.toLowerCase().includes("requested room does not exist");
}

function parsePositiveNumber(raw: string | undefined, fallback: number) {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getHistoryTurnLimit() {
  return parsePositiveNumber(process.env.ANALYZER_HISTORY_TURN_LIMIT, DEFAULT_HISTORY_TURN_LIMIT);
}

async function relayAiMessage(
  roomId: string,
  ownerUserId: string | null,
  message: ReturnType<typeof toChatMessage>,
) {
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

async function loadRoomConversationMessages(roomRefId: string) {
  return prisma.message.findMany({
    where: {
      roomRefId,
      type: {
        in: [MessageType.TEXT, MessageType.TRANSCRIPT],
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      senderName: true,
      senderUserId: true,
      participantId: true,
      content: true,
      createdAt: true,
    },
  });
}

export async function executeRealtimeAnalysisForRoomRef(roomRefId: string): Promise<AnalysisExecutionResult> {
  const room = await prisma.room.findUnique({
    where: { id: roomRefId },
    select: {
      id: true,
      roomId: true,
      name: true,
      status: true,
      createdById: true,
    },
  });
  if (!room) {
    return { executed: false, reason: "room-missing" };
  }
  if (room.status === RoomStatus.ENDED) {
    return { executed: false, reason: "room-ended" };
  }

  const state = await prisma.roomAnalysisState.findUnique({
    where: { roomRefId },
  });
  const conversationMessages = await loadRoomConversationMessages(roomRefId);
  if (conversationMessages.length === 0) {
    return { executed: false, reason: "no-conversation" };
  }

  const compacted = compactConversationForAnalysis(conversationMessages, {
    cursor: {
      lastRealtimeMessageId: state?.lastRealtimeMessageId,
      lastRealtimeMessageAt: state?.lastRealtimeMessageAt,
    },
    maxHistoryTurns: getHistoryTurnLimit(),
  });

  if (!compacted.hasCurrentRound || !compacted.latestCurrentMessageId || !compacted.latestCurrentMessageAt) {
    return { executed: false, reason: "no-new-round" };
  }

  const llmResult = await invokeRealtimeConversationAnalysis({
    roomId: room.roomId,
    speakerMap: compacted.speakerMap,
    historyConversation: compacted.historyConversation,
    currentRoundConversation: compacted.currentRoundConversation,
  }, room.createdById);
  await recordLlmUsageForOwner({
    ownerUserId: room.createdById,
    source: llmResult.source,
    totalTokens: llmResult.usage?.totalTokens,
  });
  const roomName = getRoomNameFromAnalysisPayload(llmResult.content);

  const externalRef = `analysis:realtime:${roomRefId}:${compacted.latestCurrentMessageId}`;
  const content = JSON.stringify(llmResult.content, null, 2);

  const persisted = await prisma.message.upsert({
    where: {
      externalRef,
    },
    update: {
      senderName: REALTIME_ANALYSIS_SENDER,
      participantId: null,
      type: MessageType.AI_ANALYSIS,
      content,
    },
    create: {
      roomRefId,
      type: MessageType.AI_ANALYSIS,
      senderName: REALTIME_ANALYSIS_SENDER,
      participantId: null,
      content,
      externalRef,
    },
  });

  await prisma.roomAnalysisState.upsert({
    where: {
      roomRefId,
    },
    create: {
      roomRefId,
      lastRealtimeMessageId: compacted.latestCurrentMessageId,
      lastRealtimeMessageAt: compacted.latestCurrentMessageAt,
    },
    update: {
      lastRealtimeMessageId: compacted.latestCurrentMessageId,
      lastRealtimeMessageAt: compacted.latestCurrentMessageAt,
    },
  });

  if (roomName && roomName !== room.name) {
    await prisma.room.update({
      where: {
        id: room.id,
      },
      data: {
        name: roomName,
      },
    });
  }

  try {
    await relayAiMessage(room.roomId, room.createdById, toChatMessage(persisted));
  } catch (error) {
    if (isRelayRoomMissingError(error)) {
      console.info("Skipped realtime AI analysis relay because LiveKit room is not active", {
        roomId: room.roomId,
        roomRefId,
        messageId: persisted.id,
      });
    } else {
      console.warn("Failed to relay realtime AI analysis message", {
        roomId: room.roomId,
        roomRefId,
        messageId: persisted.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return {
    executed: true,
    messageId: persisted.id,
  };
}

export async function executeFinalSummaryForRoomRef(roomRefId: string): Promise<AnalysisExecutionResult> {
  const room = await prisma.room.findUnique({
    where: { id: roomRefId },
    select: {
      id: true,
      roomId: true,
      name: true,
      createdById: true,
    },
  });
  if (!room) {
    return { executed: false, reason: "room-missing" };
  }

  const conversationMessages = await loadRoomConversationMessages(roomRefId);
  if (conversationMessages.length === 0) {
    return { executed: false, reason: "no-conversation" };
  }

  const compacted = compactConversationForAnalysis(conversationMessages, {
    maxHistoryTurns: getHistoryTurnLimit(),
  });

  if (!compacted.fullConversation) {
    return { executed: false, reason: "empty-conversation" };
  }

  const llmResult = await invokeConversationSummary({
    roomId: room.roomId,
    speakerMap: compacted.speakerMap,
    fullConversation: compacted.fullConversation,
  }, room.createdById);
  await recordLlmUsageForOwner({
    ownerUserId: room.createdById,
    source: llmResult.source,
    totalTokens: llmResult.usage?.totalTokens,
  });
  const roomName = getRoomNameFromAnalysisPayload(llmResult.content);

  const externalRef = `analysis:summary:${roomRefId}`;
  const content = JSON.stringify(llmResult.content, null, 2);

  const persisted = await prisma.message.upsert({
    where: {
      externalRef,
    },
    update: {
      senderName: FINAL_SUMMARY_SENDER,
      participantId: null,
      type: MessageType.AI_SUMMARY,
      content,
    },
    create: {
      roomRefId,
      type: MessageType.AI_SUMMARY,
      senderName: FINAL_SUMMARY_SENDER,
      participantId: null,
      content,
      externalRef,
    },
  });

  await prisma.roomAnalysisState.upsert({
    where: {
      roomRefId,
    },
    create: {
      roomRefId,
      lastFinalSummaryAt: new Date(),
    },
    update: {
      lastFinalSummaryAt: new Date(),
    },
  });

  if (roomName && roomName !== room.name) {
    await prisma.room.update({
      where: {
        id: room.id,
      },
      data: {
        name: roomName,
      },
    });
  }

  try {
    await relayAiMessage(room.roomId, room.createdById, toChatMessage(persisted));
  } catch (error) {
    if (isRelayRoomMissingError(error)) {
      console.info("Skipped final AI summary relay because LiveKit room is not active", {
        roomId: room.roomId,
        roomRefId,
        messageId: persisted.id,
      });
    } else {
      console.warn("Failed to relay final AI summary message", {
        roomId: room.roomId,
        roomRefId,
        messageId: persisted.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return {
    executed: true,
    messageId: persisted.id,
  };
}
