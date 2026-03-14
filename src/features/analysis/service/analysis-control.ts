import { MessageType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type RealtimeCursorMessage = {
  id: string;
  createdAt: Date;
};

async function upsertRealtimeAnalysisCursor(
  roomRefId: string,
  message: RealtimeCursorMessage | null,
) {
  if (!message) {
    return false;
  }

  await prisma.roomAnalysisState.upsert({
    where: {
      roomRefId,
    },
    create: {
      roomRefId,
      lastRealtimeMessageId: message.id,
      lastRealtimeMessageAt: message.createdAt,
    },
    update: {
      lastRealtimeMessageId: message.id,
      lastRealtimeMessageAt: message.createdAt,
    },
  });

  return true;
}

export async function isRealtimeAnalysisEnabledForRoom(roomRefId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomRefId },
    select: {
      analysisEnabled: true,
    },
  });

  return room?.analysisEnabled ?? false;
}

export async function advanceRealtimeAnalysisCursorToMessage(
  roomRefId: string,
  messageId: string,
) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      roomRefId: true,
      type: true,
      createdAt: true,
    },
  });

  if (
    !message ||
    message.roomRefId !== roomRefId ||
    (message.type !== MessageType.TEXT && message.type !== MessageType.TRANSCRIPT)
  ) {
    return false;
  }

  return upsertRealtimeAnalysisCursor(roomRefId, {
    id: message.id,
    createdAt: message.createdAt,
  });
}

export async function advanceRealtimeAnalysisCursorToLatestConversationMessage(roomRefId: string) {
  const latestMessage = await prisma.message.findFirst({
    where: {
      roomRefId,
      type: {
        in: [MessageType.TEXT, MessageType.TRANSCRIPT],
      },
    },
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    select: {
      id: true,
      createdAt: true,
    },
  });

  return upsertRealtimeAnalysisCursor(roomRefId, latestMessage);
}
