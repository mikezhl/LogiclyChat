import crypto from "node:crypto";

import { AnalysisEventType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  advanceRealtimeAnalysisCursorToMessage,
  isRealtimeAnalysisEnabledForRoom,
} from "./analysis-control";

const DEFAULT_EVENT_BATCH_SIZE = 200;

export type PendingAnalysisEvent = {
  id: string;
  roomRefId: string;
  eventType: AnalysisEventType;
  messageId: string | null;
  createdAt: Date;
};

function buildRealtimeEventDedupeKey(messageId: string) {
  return `realtime:${messageId}:${Date.now()}:${crypto.randomUUID()}`;
}

function buildFinalSummaryEventDedupeKey(roomRefId: string) {
  return `final-summary:${roomRefId}`;
}

export async function enqueueRealtimeAnalysisEvent(roomRefId: string, messageId: string) {
  const analysisEnabled = await isRealtimeAnalysisEnabledForRoom(roomRefId);
  if (!analysisEnabled) {
    await advanceRealtimeAnalysisCursorToMessage(roomRefId, messageId);
    return;
  }

  const dedupeKey = buildRealtimeEventDedupeKey(messageId);

  await prisma.roomAnalysisEvent.create({
    data: {
      roomRefId,
      eventType: AnalysisEventType.REALTIME_TRIGGER,
      messageId,
      dedupeKey,
    },
  });
}

export async function enqueueFinalSummaryAnalysisEvent(roomRefId: string) {
  const dedupeKey = buildFinalSummaryEventDedupeKey(roomRefId);

  await prisma.roomAnalysisEvent.upsert({
    where: { dedupeKey },
    create: {
      roomRefId,
      eventType: AnalysisEventType.FINAL_SUMMARY_TRIGGER,
      dedupeKey,
    },
    update: {
      roomRefId,
    },
  });
}

export async function pullPendingAnalysisEvents(limit = DEFAULT_EVENT_BATCH_SIZE): Promise<PendingAnalysisEvent[]> {
  return prisma.roomAnalysisEvent.findMany({
    where: {
      processedAt: null,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
    select: {
      id: true,
      roomRefId: true,
      eventType: true,
      messageId: true,
      createdAt: true,
    },
  });
}

export async function markAnalysisEventsProcessed(eventIds: string[]) {
  if (eventIds.length === 0) {
    return;
  }

  await prisma.roomAnalysisEvent.updateMany({
    where: {
      id: {
        in: eventIds,
      },
    },
    data: {
      processedAt: new Date(),
    },
  });
}

export async function markAnalysisEventProcessed(eventId: string) {
  await prisma.roomAnalysisEvent.update({
    where: {
      id: eventId,
    },
    data: {
      processedAt: new Date(),
    },
  });
}
