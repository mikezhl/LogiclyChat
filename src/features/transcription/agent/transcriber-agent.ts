import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { RoomServiceClient } from "livekit-server-sdk";

import {
  AutoSubscribe,
  ServerOptions,
  cli,
  defineAgent,
  runWithJobContextAsync,
  type JobContext,
} from "@livekit/agents";
import {
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
  RoomEvent,
  TrackKind,
  TrackSource,
} from "@livekit/rtc-node";
import { getRealtimeTranscriptionProviderAdapter } from "@/features/transcription/core/registry";
import {
  getTranscriberAgentName,
  resolveRoomVoiceRuntimeForOwner,
  type RoomVoiceRuntime,
} from "@/features/transcription/core/runtime";
import type { RealtimeTranscriptionProviderSession } from "@/features/transcription/core/session";
import {
  resolveActiveRoomRefId,
  TranscriptAccumulator,
  type TranscribedParticipant,
} from "@/features/transcription/core/transcript-sink";
import { createRoomServiceClient } from "@/lib/livekit-chat-relay";
import { prisma as sharedPrisma } from "@/lib/prisma";
import { type KeySource } from "@/lib/provider-sources";
import { recordVoiceUsageForOwner } from "@/lib/usage-stats";

const prisma = sharedPrisma instanceof PrismaClient ? sharedPrisma : new PrismaClient();
const AGENT_PARTICIPANT_KIND = 4;

type SpeechState = "listening" | "speaking";

type ParticipantTranscriptionSession = {
  participant: TranscribedParticipant;
  roomRefId: string;
  ownerUserId: string | null;
  voiceUsageSource: KeySource;
  providerSession: RealtimeTranscriptionProviderSession;
  transcriptAccumulator: TranscriptAccumulator;
  speechState: SpeechState;
  speechStartedAtMs: number | null;
  closed: boolean;
  consumeTask: Promise<void>;
};

function logInfo(message: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.info(`[transcriber] ${message}`, payload);
    return;
  }

  console.info(`[transcriber] ${message}`);
}

function logError(message: string, error: unknown, payload?: Record<string, unknown>) {
  console.error(`[transcriber] ${message}`, {
    ...(payload ?? {}),
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
  });
}

function parseNumberEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function createRelayRoomServiceClient(roomVoiceRuntime: RoomVoiceRuntime): RoomServiceClient | null {
  const livekitUrl = roomVoiceRuntime.livekit.livekitUrl;
  const livekitApiKey = roomVoiceRuntime.livekit.livekitApiKey;
  const livekitApiSecret = roomVoiceRuntime.livekit.livekitApiSecret;

  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    return null;
  }

  return createRoomServiceClient({
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
  });
}

function buildTranscriptionRuntimeLogPayload(roomVoiceRuntime: RoomVoiceRuntime) {
  return {
    roomVoiceReady: roomVoiceRuntime.ready,
    roomVoiceSource: roomVoiceRuntime.source,
    transcriberEnabled: roomVoiceRuntime.transcriberEnabled,
    livekit: {
      source: roomVoiceRuntime.livekit.source,
      configured: roomVoiceRuntime.livekit.configured,
      credentialMask: roomVoiceRuntime.livekit.livekitApiKeyMask,
    },
    transcription: roomVoiceRuntime.transcription
      ? {
          provider: roomVoiceRuntime.transcription.provider,
          source: roomVoiceRuntime.transcription.source,
          configured: roomVoiceRuntime.transcription.configured,
          credentialMask: roomVoiceRuntime.transcription.credentialMask,
          model: roomVoiceRuntime.transcription.model,
          baseUrl:
            roomVoiceRuntime.transcription.provider === "dashscope"
              ? roomVoiceRuntime.transcription.baseUrl
              : undefined,
        }
      : null,
    error: roomVoiceRuntime.error,
  };
}

function flushSpeechUsage(session: ParticipantTranscriptionSession, roomId: string) {
  if (session.speechStartedAtMs === null) {
    return;
  }

  const durationMs = Math.max(0, Date.now() - session.speechStartedAtMs);
  session.speechStartedAtMs = null;
  if (durationMs <= 0) {
    return;
  }

  void recordVoiceUsageForOwner({
    ownerUserId: session.ownerUserId,
    source: session.voiceUsageSource,
    durationMs,
  }).catch((error) => {
    logError("Failed to record voice usage", error, {
      roomId,
      participantIdentity: session.participant.identity,
      durationMs,
      source: session.voiceUsageSource,
    });
  });
}

function updateSpeechState(session: ParticipantTranscriptionSession, roomId: string, nextState: SpeechState) {
  if (session.speechState === nextState) {
    return;
  }

  const previousState = session.speechState;
  if (nextState === "speaking") {
    session.speechStartedAtMs = Date.now();
  } else if (previousState === "speaking") {
    flushSpeechUsage(session, roomId);
  }
  session.speechState = nextState;
}

function getRemoteParticipantMicrophonePublication(
  participant: RemoteParticipant,
): RemoteTrackPublication | null {
  for (const publication of participant.trackPublications.values()) {
    if (publication.source === TrackSource.SOURCE_MICROPHONE) {
      return publication;
    }
  }

  return null;
}

async function clearParticipantAudioInput(
  session: ParticipantTranscriptionSession,
  roomId: string,
  reason: string,
  flush = true,
) {
  updateSpeechState(session, roomId, "listening");
  await session.providerSession.updateTrack(null, null, reason);
  if (flush && !session.closed) {
    await session.providerSession.flush().catch(() => undefined);
  }
}

async function syncParticipantMicrophoneInput({
  session,
  participant,
  roomId,
}: {
  session: ParticipantTranscriptionSession;
  participant: RemoteParticipant;
  roomId: string;
}) {
  if (session.closed) {
    return;
  }

  const publication = getRemoteParticipantMicrophonePublication(participant);
  if (!publication) {
    await clearParticipantAudioInput(session, roomId, "microphone_unpublished");
    return;
  }

  if (!publication.subscribed) {
    publication.setSubscribed(true);
  }

  if (publication.muted) {
    await clearParticipantAudioInput(session, roomId, "microphone_muted");
    return;
  }

  if (!publication.track || publication.kind !== TrackKind.KIND_AUDIO) {
    await clearParticipantAudioInput(session, roomId, "microphone_track_missing");
    return;
  }

  await session.providerSession.updateTrack(
    publication.track as RemoteAudioTrack,
    publication.sid ?? null,
    "microphone_attached",
  );
}

async function consumeParticipantSpeechStream({
  session,
  roomId,
}: {
  session: ParticipantTranscriptionSession;
  roomId: string;
}) {
  try {
    for await (const event of session.providerSession) {
      if (session.closed) {
        break;
      }

      switch (event.type) {
        case "speech_started":
          updateSpeechState(session, roomId, "speaking");
          break;
        case "speech_stopped":
          updateSpeechState(session, roomId, "listening");
          break;
        case "transcript":
          session.transcriptAccumulator.handleUpdate({
            transcript: event.text,
            isFinal: event.isFinal,
            language: event.language,
          });
          break;
      }
    }
  } catch (error) {
    if (!session.closed) {
      logError("Participant speech stream failed", error, {
        roomId,
        participantIdentity: session.participant.identity,
      });
    }
  }
}

async function closeParticipantSession({
  session,
  sessionRegistry,
  roomId,
  reason,
}: {
  session: ParticipantTranscriptionSession;
  sessionRegistry: Map<string, ParticipantTranscriptionSession>;
  roomId: string;
  reason: string;
}) {
  if (session.closed) {
    return;
  }

  session.closed = true;
  sessionRegistry.delete(session.participant.identity);

  await clearParticipantAudioInput(session, roomId, reason, false);
  await session.providerSession.close().catch((error) => {
    logError("Failed to close provider session", error, {
      roomId,
      participantIdentity: session.participant.identity,
      provider: session.providerSession.runtime.provider,
    });
  });
  await session.consumeTask.catch(() => undefined);
  await session.transcriptAccumulator.close();

  logInfo("Participant transcription session closed", {
    roomId,
    participantIdentity: session.participant.identity,
    reason,
  });
}

async function startParticipantSession({
  ctx,
  participant,
  roomId,
  roomVoiceRuntime,
  ownerUserId,
  relayRoomServiceClient,
  sessionRegistry,
}: {
  ctx: JobContext;
  participant: TranscribedParticipant;
  roomId: string;
  roomVoiceRuntime: RoomVoiceRuntime;
  ownerUserId: string | null;
  relayRoomServiceClient: RoomServiceClient | null;
  sessionRegistry: Map<string, ParticipantTranscriptionSession>;
}) {
  if (participant.kind === AGENT_PARTICIPANT_KIND) {
    return;
  }

  if (sessionRegistry.has(participant.identity)) {
    return;
  }

  if (!roomVoiceRuntime.transcriberEnabled || !roomVoiceRuntime.transcription?.configured) {
    throw new Error("Transcription runtime is unavailable for this room");
  }

  const roomRefId = await resolveActiveRoomRefId(prisma, roomId);
  if (!roomRefId) {
    return;
  }

  const adapter = getRealtimeTranscriptionProviderAdapter(roomVoiceRuntime.transcription.provider);
  logInfo("Starting participant transcription session", {
    roomId,
    participantIdentity: participant.identity,
    provider: roomVoiceRuntime.transcription.provider,
    transcriptionSource: roomVoiceRuntime.transcription.source,
    transcriptionCredentialMask: roomVoiceRuntime.transcription.credentialMask,
    livekitSource: roomVoiceRuntime.livekit.source,
    livekitCredentialMask: roomVoiceRuntime.livekit.livekitApiKeyMask,
    model: roomVoiceRuntime.transcription.model,
  });
  const providerSession = await adapter.createSession({
    roomId,
    participantIdentity: participant.identity,
    runtime: roomVoiceRuntime.transcription,
  });

  const session: ParticipantTranscriptionSession = {
    participant,
    roomRefId,
    ownerUserId,
    voiceUsageSource: roomVoiceRuntime.source,
    providerSession,
    transcriptAccumulator: new TranscriptAccumulator(
      prisma,
      roomId,
      roomRefId,
      participant,
      relayRoomServiceClient,
    ),
    speechState: "listening",
    speechStartedAtMs: null,
    closed: false,
    consumeTask: Promise.resolve(),
  };

  session.consumeTask = consumeParticipantSpeechStream({
    session,
    roomId,
  });
  sessionRegistry.set(participant.identity, session);

  const remoteParticipant = ctx.room.remoteParticipants.get(participant.identity);
  if (remoteParticipant) {
    await syncParticipantMicrophoneInput({
      session,
      participant: remoteParticipant,
      roomId,
    });
  }
}

async function ensureParticipantSession({
  ctx,
  participant,
  roomId,
  roomVoiceRuntime,
  ownerUserId,
  relayRoomServiceClient,
  sessionRegistry,
  startingSessionRegistry,
}: {
  ctx: JobContext;
  participant: TranscribedParticipant;
  roomId: string;
  roomVoiceRuntime: RoomVoiceRuntime;
  ownerUserId: string | null;
  relayRoomServiceClient: RoomServiceClient | null;
  sessionRegistry: Map<string, ParticipantTranscriptionSession>;
  startingSessionRegistry: Set<string>;
}) {
  if (participant.kind === AGENT_PARTICIPANT_KIND || sessionRegistry.has(participant.identity)) {
    return;
  }

  if (startingSessionRegistry.has(participant.identity)) {
    return;
  }

  startingSessionRegistry.add(participant.identity);
  try {
    await runWithJobContextAsync(ctx, async () => {
      await startParticipantSession({
        ctx,
        participant,
        roomId,
        roomVoiceRuntime,
        ownerUserId,
        relayRoomServiceClient,
        sessionRegistry,
      });
    });
  } finally {
    startingSessionRegistry.delete(participant.identity);
  }
}

async function resolveRoomVoiceRuntime(roomId: string): Promise<RoomVoiceRuntime> {
  const room = await prisma.room.findUnique({
    where: { roomId },
    select: {
      createdById: true,
    },
  });

  return resolveRoomVoiceRuntimeForOwner(room?.createdById);
}

async function resolveRoomOwnerUserId(roomId: string): Promise<string | null> {
  const room = await prisma.room.findUnique({
    where: { roomId },
    select: {
      createdById: true,
    },
  });
  return room?.createdById ?? null;
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const roomId = ctx.job.room?.name ?? "";
    if (!roomId) {
      throw new Error("Room name is required for transcriber agent");
    }

    const sessions = new Map<string, ParticipantTranscriptionSession>();
    const startingSessions = new Set<string>();
    const [roomVoiceRuntime, ownerUserId] = await Promise.all([
      resolveRoomVoiceRuntime(roomId),
      resolveRoomOwnerUserId(roomId),
    ]);
    logInfo("Resolved room voice runtime", {
      roomId,
      ...buildTranscriptionRuntimeLogPayload(roomVoiceRuntime),
      ownerUserId,
    });
    if (!roomVoiceRuntime.ready || !roomVoiceRuntime.transcription) {
      throw new Error(roomVoiceRuntime.error ?? "Room transcription runtime is unavailable");
    }
    const relayRoomServiceClient = createRelayRoomServiceClient(roomVoiceRuntime);
    if (!relayRoomServiceClient) {
      logInfo("Transcript relay is disabled because room-scoped LiveKit credentials are unavailable", {
        roomId,
        livekitSource: roomVoiceRuntime.livekit.source,
        livekitConfigured: roomVoiceRuntime.livekit.configured,
      });
    }

    const ensureAndSyncParticipant = async (participant: RemoteParticipant) => {
      await ensureParticipantSession({
        ctx,
        participant,
        roomId,
        roomVoiceRuntime,
        ownerUserId,
        relayRoomServiceClient,
        sessionRegistry: sessions,
        startingSessionRegistry: startingSessions,
      });

      const session = sessions.get(participant.identity);
      if (!session) {
        return;
      }

      await syncParticipantMicrophoneInput({
        session,
        participant,
        roomId,
      });
    };

    const syncParticipantByIdentity = async (identity: string) => {
      const participant = ctx.room.remoteParticipants.get(identity);
      if (!participant) {
        return;
      }

      await ensureAndSyncParticipant(participant);
    };

    const closeSessionByIdentity = async (identity: string, reason: string) => {
      const session = sessions.get(identity);
      if (!session) {
        return;
      }

      await closeParticipantSession({
        session,
        sessionRegistry: sessions,
        roomId,
        reason,
      });
    };

    ctx.addParticipantEntrypoint((jobCtx, participant) => {
      void runWithJobContextAsync(jobCtx, async () => {
        await ensureAndSyncParticipant(participant);
      }).catch((error) => {
        logError("Failed to start participant transcription session", error, {
          roomId,
          participantIdentity: participant.identity,
        });
      });

      return Promise.resolve();
    });

    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);

    ctx.room.on(RoomEvent.TrackSubscribed, (_track, publication, participant) => {
      if (publication.source !== TrackSource.SOURCE_MICROPHONE) {
        return;
      }

      void ensureAndSyncParticipant(participant).catch((error) => {
        logError("Failed to attach participant microphone stream", error, {
          roomId,
          participantIdentity: participant.identity,
          trackSid: publication.sid,
        });
      });
    });

    ctx.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (publication.source !== TrackSource.SOURCE_MICROPHONE) {
        return;
      }

      void ensureAndSyncParticipant(participant).catch((error) => {
        logError("Failed to react to microphone publication", error, {
          roomId,
          participantIdentity: participant.identity,
          trackSid: publication.sid,
        });
      });
    });

    ctx.room.on(RoomEvent.TrackUnsubscribed, (_track, publication, participant) => {
      if (publication.source !== TrackSource.SOURCE_MICROPHONE) {
        return;
      }

      const session = sessions.get(participant.identity);
      if (!session) {
        return;
      }

      void clearParticipantAudioInput(session, roomId, "microphone_unsubscribed").catch((error) => {
        logError("Failed to detach unsubscribed microphone stream", error, {
          roomId,
          participantIdentity: participant.identity,
          trackSid: publication.sid,
        });
      });
    });

    ctx.room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      if (publication.source !== TrackSource.SOURCE_MICROPHONE) {
        return;
      }

      const session = sessions.get(participant.identity);
      if (!session) {
        return;
      }

      void syncParticipantMicrophoneInput({
        session,
        participant,
        roomId,
      }).catch((error) => {
        logError("Failed to handle microphone unpublish", error, {
          roomId,
          participantIdentity: participant.identity,
          trackSid: publication.sid,
        });
      });
    });

    const handleParticipantTrackStateChange = (participant: Participant) => {
      if (participant.kind === AGENT_PARTICIPANT_KIND) {
        return;
      }

      void syncParticipantByIdentity(participant.identity).catch((error) => {
        logError("Failed to sync participant microphone state", error, {
          roomId,
          participantIdentity: participant.identity,
        });
      });
    };

    ctx.room.on(RoomEvent.TrackMuted, (publication, participant) => {
      if (publication.source === TrackSource.SOURCE_MICROPHONE) {
        handleParticipantTrackStateChange(participant);
      }
    });

    ctx.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      if (publication.source === TrackSource.SOURCE_MICROPHONE) {
        handleParticipantTrackStateChange(participant);
      }
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      void closeSessionByIdentity(participant.identity, "participant_disconnected").catch((error) => {
        logError("Failed to close participant transcription session", error, {
          roomId,
          participantIdentity: participant.identity,
        });
      });
    });

    await Promise.allSettled(
      [...ctx.room.remoteParticipants.values()].map(async (participant) => ensureAndSyncParticipant(participant)),
    );

    ctx.addShutdownCallback(async () => {
      await Promise.allSettled(
        [...sessions.values()].map(async (session) => {
          await closeParticipantSession({
            session,
            sessionRegistry: sessions,
            roomId,
            reason: "worker_shutdown",
          });
        }),
      );
      await prisma.$disconnect();
    });
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: getTranscriberAgentName(),
      numIdleProcesses: parseNumberEnv(process.env.TRANSCRIBER_WORKER_IDLE_PROCESSES, 1),
    }),
  );
}
