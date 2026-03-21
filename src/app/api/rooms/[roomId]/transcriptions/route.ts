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
import { isRoomSpeakerSwitchEnabled } from "@/lib/env";
import { toChatMessage } from "@/lib/messages";
import { assertRoomUserCanParticipate } from "@/lib/room-members";
import { prisma } from "@/lib/prisma";
import { assertRoomOwnerActiveOrThrow } from "@/lib/room-presence";
import { RoomAccessError, assertRoomNotEnded, getAccessibleRoomOrThrow } from "@/lib/rooms";
import { buildRoomSpeakerProfile, resolveRoomSpeakerMode } from "@/lib/room-speaker";
import { normalizeDisplayName, normalizeRoomId } from "@/lib/room-utils";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

type IncomingTranscriptionSegment = {
  id?: string;
  text?: string;
  final?: boolean;
  language?: string;
};

type SaveTranscriptionRequest = {
  participantId?: string;
  participantName?: string;
  speakerMode?: string;
  segments?: IncomingTranscriptionSegment[];
};

function getExternalRef(roomId: string, participantId: string | undefined, segmentId?: string): string | null {
  if (!segmentId) {
    return null;
  }

  return `${roomId}:${participantId ?? "unknown"}:${segmentId}`;
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

    const body = (await request.json()) as SaveTranscriptionRequest;
    const speakerMode = body?.speakerMode == null ? null : resolveRoomSpeakerMode(body.speakerMode);
    const segments = (body.segments ?? []).filter(
      (segment): segment is IncomingTranscriptionSegment =>
        typeof segment?.text === "string" && segment.text.trim().length > 0,
    );

    if (segments.length === 0) {
      return NextResponse.json({ messages: [] });
    }

    const room = await getAccessibleRoomOrThrow(roomId, user.id);
    assertRoomNotEnded(room.status);
    await assertRoomOwnerActiveOrThrow(room, user.id);
    await assertRoomUserCanParticipate(room.id, room.createdById, user.id);
    if (speakerMode === "bot" && !isRoomSpeakerSwitchEnabled()) {
      return NextResponse.json({ error: "room speaker switch is disabled" }, { status: 403 });
    }
    const speakerProfile =
      speakerMode === null
        ? null
        : buildRoomSpeakerProfile({
            userId: user.id,
            username: user.username,
            mode: speakerMode,
          });
    const participantId = speakerProfile?.participantIdentity ?? body.participantId?.trim() ?? undefined;
    const senderName = speakerProfile?.displayName ?? normalizeDisplayName(body.participantName);
    const persisted = [];

    void ensureConversationAnalysisWorker({
      waitForReady: false,
      reason: `transcriptions-route:${roomId}`,
    }).catch((workerError) => {
      console.warn("Failed to ensure conversation analysis worker", {
        roomId,
        error: workerError instanceof Error ? workerError.message : workerError,
      });
    });

    for (const segment of segments) {
      if (segment.final === false) {
        continue;
      }

      const externalRef = getExternalRef(roomId, participantId, segment.id);
      const content = segment.text!.trim();

      if (!content) {
        continue;
      }

      if (externalRef) {
        const message = await prisma.message.upsert({
          where: { externalRef },
          create: {
            roomRefId: room.id,
            type: MessageType.TRANSCRIPT,
            senderName,
            senderUserId: speakerProfile?.senderUserId ?? null,
            participantId: participantId ?? null,
            content,
            externalRef,
          },
          update: {
            content,
            senderName,
            senderUserId: speakerProfile?.senderUserId ?? null,
            participantId: participantId ?? null,
          },
        });

        persisted.push(message);
        try {
          await enqueueRealtimeAnalysisEvent(room.id, message.id);
        } catch (enqueueError) {
          if (isAnalysisSchemaMissingError(enqueueError)) {
            console.warn("Analysis queue unavailable while enqueuing transcription", {
              roomId,
              messageId: message.id,
              hint: getAnalysisSchemaFixHint(),
              error: formatCompactAnalysisError(enqueueError),
            });
          } else {
            console.warn("Failed to enqueue transcription analysis event", {
              roomId,
              messageId: message.id,
              error: formatCompactAnalysisError(enqueueError),
            });
          }
        }
      } else {
        const message = await prisma.message.create({
          data: {
            roomRefId: room.id,
            type: MessageType.TRANSCRIPT,
            senderName,
            senderUserId: speakerProfile?.senderUserId ?? null,
            participantId: participantId ?? null,
            content,
          },
        });
        persisted.push(message);
        try {
          await enqueueRealtimeAnalysisEvent(room.id, message.id);
        } catch (enqueueError) {
          if (isAnalysisSchemaMissingError(enqueueError)) {
            console.warn("Analysis queue unavailable while enqueuing transcription", {
              roomId,
              messageId: message.id,
              hint: getAnalysisSchemaFixHint(),
              error: formatCompactAnalysisError(enqueueError),
            });
          } else {
            console.warn("Failed to enqueue transcription analysis event", {
              roomId,
              messageId: message.id,
              error: formatCompactAnalysisError(enqueueError),
            });
          }
        }
      }
    }

    return NextResponse.json({
      messages: persisted.map(toChatMessage),
    });
  } catch (error) {
    if (error instanceof RoomAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error ? error.message : "Failed to persist transcription segments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
