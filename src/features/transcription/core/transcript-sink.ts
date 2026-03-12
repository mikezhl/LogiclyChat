import { MessageType, PrismaClient, RoomStatus } from "@prisma/client";
import { RoomServiceClient } from "livekit-server-sdk";

import { enqueueRealtimeAnalysisEvent } from "@/features/analysis/service/analysis-events";
import {
  formatCompactAnalysisError,
  getAnalysisSchemaFixHint,
  isAnalysisSchemaMissingError,
} from "@/features/analysis/service/analysis-errors";
import { publishChatMessageViaLivekit } from "@/lib/livekit-chat-relay";
import { toChatMessage } from "@/lib/messages";

const TRANSCRIPT_UTTERANCE_GAP_MS = parseNumberEnv(process.env.TRANSCRIPT_UTTERANCE_GAP_MS, 2000);

export type TranscribedParticipant = {
  identity: string;
  name?: string;
  kind?: number;
};

type TranscriptWindowState = {
  externalRef: string;
  windowStartedAt: number;
  lastActivityAt: number;
  committedText: string;
  interimText: string;
  lastPersistedText: string;
  persistChain: Promise<void>;
};

function parseNumberEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function logInfo(message: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.info(`[transcriber] ${message}`, payload);
    return;
  }
  console.info(`[transcriber] ${message}`);
}

function logWarn(message: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.warn(`[transcriber] ${message}`, payload);
    return;
  }
  console.warn(`[transcriber] ${message}`);
}

function logError(message: string, error: unknown, payload?: Record<string, unknown>) {
  console.error(`[transcriber] ${message}`, {
    ...(payload ?? {}),
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
  });
}

function normalizeSenderName(participant: TranscribedParticipant) {
  const name = participant.name?.trim();
  if (name && name.length > 0) {
    return name.slice(0, 40);
  }

  const identity = participant.identity.trim();
  if (identity.length > 0) {
    return identity.slice(0, 40);
  }

  return "Voice User";
}

function normalizeTranscriptText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function shouldInsertSpace(left: string, right: string) {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

function mergeTranscriptText(base: string, incoming: string) {
  const current = normalizeTranscriptText(base);
  const next = normalizeTranscriptText(incoming);

  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  if (next.startsWith(current)) {
    return next;
  }
  if (current.endsWith(next)) {
    return current;
  }
  return shouldInsertSpace(current, next) ? `${current} ${next}` : `${current}${next}`;
}

function createTranscriptWindowExternalRef(roomId: string, participantId: string, windowStartedAt: number) {
  return `${roomId}:${participantId}:utterance:${windowStartedAt}`;
}

function createTranscriptWindowState(
  roomId: string,
  participantId: string,
  nowMs: number,
): TranscriptWindowState {
  return {
    externalRef: createTranscriptWindowExternalRef(roomId, participantId, nowMs),
    windowStartedAt: nowMs,
    lastActivityAt: nowMs,
    committedText: "",
    interimText: "",
    lastPersistedText: "",
    persistChain: Promise.resolve(),
  };
}

export async function resolveActiveRoomRefId(prisma: PrismaClient, roomId: string) {
  const room = await prisma.room.findUnique({
    where: { roomId },
    select: {
      id: true,
      status: true,
    },
  });
  if (!room) {
    logWarn("Skip transcript persistence for missing room", { roomId });
    return null;
  }
  if (room.status === RoomStatus.ENDED) {
    logInfo("Skip transcript persistence for ended room", { roomId });
    return null;
  }
  return room.id;
}

async function upsertTranscriptMessage({
  prisma,
  roomRefId,
  participant,
  transcript,
  externalRef,
  windowStartedAt,
}: {
  prisma: PrismaClient;
  roomRefId: string;
  participant: TranscribedParticipant;
  transcript: string;
  externalRef: string;
  windowStartedAt: number;
}) {
  const content = normalizeTranscriptText(transcript);
  if (!content) {
    return null;
  }

  return prisma.message.upsert({
    where: {
      externalRef,
    },
    update: {
      senderName: normalizeSenderName(participant),
      participantId: participant.identity,
      content,
    },
    create: {
      roomRefId,
      type: MessageType.TRANSCRIPT,
      externalRef,
      senderName: normalizeSenderName(participant),
      participantId: participant.identity,
      content,
      createdAt: new Date(windowStartedAt),
    },
  });
}

export class TranscriptAccumulator {
  private window: TranscriptWindowState | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly roomId: string,
    private readonly roomRefId: string,
    private readonly participant: TranscribedParticipant,
    private readonly relayRoomServiceClient: RoomServiceClient | null,
  ) {}

  handleUpdate({ transcript, isFinal, language }: {
    transcript: string;
    isFinal: boolean;
    language?: string;
  }) {
    const normalizedTranscript = normalizeTranscriptText(transcript);
    if (!normalizedTranscript) {
      return;
    }

    const nowMs = Date.now();
    let window = this.window;
    if (!window || nowMs - window.lastActivityAt > TRANSCRIPT_UTTERANCE_GAP_MS) {
      window = createTranscriptWindowState(this.roomId, this.participant.identity, nowMs);
      this.window = window;
      logInfo("Started transcript utterance window", {
        roomId: this.roomId,
        participantIdentity: this.participant.identity,
        externalRef: window.externalRef,
        startedAt: new Date(window.windowStartedAt).toISOString(),
      });
    }

    window.lastActivityAt = nowMs;
    if (isFinal) {
      window.committedText = mergeTranscriptText(window.committedText, normalizedTranscript);
      window.interimText = "";
    } else {
      window.interimText = normalizedTranscript;
    }

    const composedTranscript = isFinal
      ? window.committedText
      : mergeTranscriptText(window.committedText, window.interimText);
    if (!composedTranscript || composedTranscript === window.lastPersistedText) {
      return;
    }

    window.lastPersistedText = composedTranscript;

    const externalRef = window.externalRef;
    const windowStartedAt = window.windowStartedAt;
    const transcriptForSave = composedTranscript;
    window.persistChain = window.persistChain
      .catch(() => undefined)
      .then(async () => {
        const persistedMessage = await upsertTranscriptMessage({
          prisma: this.prisma,
          roomRefId: this.roomRefId,
          participant: this.participant,
          transcript: transcriptForSave,
          externalRef,
          windowStartedAt,
        });
        if (!persistedMessage) {
          return;
        }

        try {
          await enqueueRealtimeAnalysisEvent(this.roomRefId, persistedMessage.id);
        } catch (enqueueError) {
          if (isAnalysisSchemaMissingError(enqueueError)) {
            logWarn("Analysis queue unavailable while enqueuing transcript event", {
              roomId: this.roomId,
              participantIdentity: this.participant.identity,
              messageId: persistedMessage.id,
              hint: getAnalysisSchemaFixHint(),
              error: formatCompactAnalysisError(enqueueError),
            });
          } else {
            logWarn("Failed to enqueue transcript analysis event", {
              roomId: this.roomId,
              participantIdentity: this.participant.identity,
              messageId: persistedMessage.id,
              error: formatCompactAnalysisError(enqueueError),
            });
          }
        }

        const chatMessage = toChatMessage(persistedMessage);
        if (this.relayRoomServiceClient) {
          void publishChatMessageViaLivekit(this.relayRoomServiceClient, this.roomId, chatMessage).catch(
            (relayError) => {
              logWarn("Failed to relay transcript through LiveKit data channel", {
                roomId: this.roomId,
                participantIdentity: this.participant.identity,
                messageId: chatMessage.id,
                error: relayError instanceof Error ? relayError.message : relayError,
              });
            },
          );
        }

        logInfo("Transcript upserted", {
          roomId: this.roomId,
          participantIdentity: this.participant.identity,
          messageId: chatMessage.id,
          externalRef,
          isFinal,
          text: transcriptForSave,
        });
      })
      .catch((error) => {
        logError("Failed to upsert transcript", error, {
          roomId: this.roomId,
          participantIdentity: this.participant.identity,
          externalRef,
        });
      });

    logInfo("Transcript update", {
      roomId: this.roomId,
      participantIdentity: this.participant.identity,
      isFinal,
      text: transcriptForSave,
      language,
    });
  }

  async close() {
    await this.window?.persistChain.catch(() => undefined);
    this.window = null;
  }
}
