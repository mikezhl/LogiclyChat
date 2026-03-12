import {
  AgentDispatchClient,
  ParticipantInfo,
  ParticipantInfo_State,
  RoomServiceClient,
  TrackSource,
  TwirpError,
} from "livekit-server-sdk";

import {
  getTranscriberAgentName,
  isTranscriberEnabled,
} from "@/features/transcription/core/runtime";
import { requireEnv } from "@/lib/env";

export type TranscriberDispatchResult = {
  enabled: boolean;
  roomEnsured: boolean;
  agentName: string | null;
  existingDispatchCount: number;
  alreadyDispatched: boolean;
  createdDispatchId: string | null;
};

export type LivekitDispatchCredentials = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

export type ReleaseTranscriberDispatchResult = {
  enabled: boolean;
  agentName: string | null;
  activeVoiceParticipantCount: number;
  ignoredParticipantIdentity: string | null;
  existingDispatchCount: number;
  deletedDispatchCount: number;
  removedAgentCount: number;
  roomFound: boolean;
  released: boolean;
};

type ReleaseTranscriberDispatchOptions = {
  credentials?: LivekitDispatchCredentials;
  ignoredParticipantIdentity?: string | null;
};

const LIVEKIT_AGENT_PARTICIPANT_KIND = 4;

function isTwirpCode(error: unknown, code: string) {
  return (
    error instanceof TwirpError &&
    typeof error.code === "string" &&
    error.code.toLowerCase() === code.toLowerCase()
  );
}

async function ensureLiveKitRoomExists(roomId: string, credentials: LivekitDispatchCredentials) {
  const roomClient = createRoomServiceClient(credentials);

  try {
    await roomClient.createRoom({
      name: roomId,
    });
  } catch (error) {
    if (isTwirpCode(error, "already_exists")) {
      return;
    }
    throw error;
  }
}

function createRoomServiceClient(credentials: LivekitDispatchCredentials) {
  return new RoomServiceClient(
    credentials.livekitUrl,
    credentials.livekitApiKey,
    credentials.livekitApiSecret,
  );
}

function createDispatchClient(credentials: LivekitDispatchCredentials) {
  return new AgentDispatchClient(
    credentials.livekitUrl,
    credentials.livekitApiKey,
    credentials.livekitApiSecret,
  );
}

function hasActiveMicrophoneTrack(participant: ParticipantInfo, ignoredParticipantIdentity?: string | null) {
  if (participant.identity === ignoredParticipantIdentity) {
    return false;
  }

  if (participant.kind === LIVEKIT_AGENT_PARTICIPANT_KIND) {
    return false;
  }

  if (participant.state === ParticipantInfo_State.DISCONNECTED) {
    return false;
  }

  return participant.tracks.some(
    (track) => track.source === TrackSource.MICROPHONE && !track.muted,
  );
}

function logDispatch(message: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.info(`[transcriber-dispatch] ${message}`, payload);
    return;
  }
  console.info(`[transcriber-dispatch] ${message}`);
}

export async function ensureTranscriberDispatch(
  roomId: string,
  credentials?: LivekitDispatchCredentials,
): Promise<TranscriberDispatchResult> {
  if (!isTranscriberEnabled()) {
    logDispatch("Transcriber disabled by env", { roomId });
    return {
      enabled: false,
      roomEnsured: false,
      agentName: null,
      existingDispatchCount: 0,
      alreadyDispatched: false,
      createdDispatchId: null,
    };
  }

  const resolvedCredentials: LivekitDispatchCredentials = credentials ?? {
    livekitUrl: requireEnv("LIVEKIT_URL"),
    livekitApiKey: requireEnv("LIVEKIT_API_KEY"),
    livekitApiSecret: requireEnv("LIVEKIT_API_SECRET"),
  };
  const agentName = getTranscriberAgentName();

  logDispatch("Ensuring room exists before dispatch", { roomId, agentName });
  await ensureLiveKitRoomExists(roomId, resolvedCredentials);

  const dispatchClient = createDispatchClient(resolvedCredentials);
  const existingDispatches = await dispatchClient.listDispatch(roomId);
  logDispatch("Fetched existing dispatches", {
    roomId,
    agentName,
    existingDispatchCount: existingDispatches.length,
    dispatchAgentNames: existingDispatches.map((dispatch) => dispatch.agentName ?? "(empty)"),
  });
  const alreadyDispatched = existingDispatches.some((dispatch) => dispatch.agentName === agentName);

  if (!alreadyDispatched) {
    try {
      const createdDispatch = await dispatchClient.createDispatch(roomId, agentName, {
        metadata: JSON.stringify({
          provider: "transcriber",
          source: "jileme",
          roomId,
        }),
      });
      logDispatch("Created transcriber dispatch", {
        roomId,
        agentName,
        dispatchId: createdDispatch.id,
      });
      return {
        enabled: true,
        roomEnsured: true,
        agentName,
        existingDispatchCount: existingDispatches.length,
        alreadyDispatched: false,
        createdDispatchId: createdDispatch.id ?? null,
      };
    } catch (error) {
      if (isTwirpCode(error, "already_exists")) {
        logDispatch("Dispatch already exists (race)", { roomId, agentName });
        return {
          enabled: true,
          roomEnsured: true,
          agentName,
          existingDispatchCount: existingDispatches.length,
          alreadyDispatched: true,
          createdDispatchId: null,
        };
      }
      throw error;
    }
  }

  logDispatch("Dispatch already present", { roomId, agentName });
  return {
    enabled: true,
    roomEnsured: true,
    agentName,
    existingDispatchCount: existingDispatches.length,
    alreadyDispatched: true,
    createdDispatchId: null,
  };
}

export async function releaseTranscriberDispatchIfIdle(
  roomId: string,
  options?: ReleaseTranscriberDispatchOptions,
): Promise<ReleaseTranscriberDispatchResult> {
  const ignoredParticipantIdentity = options?.ignoredParticipantIdentity?.trim() || null;

  if (!isTranscriberEnabled()) {
    logDispatch("Skip release because transcriber is disabled", { roomId, ignoredParticipantIdentity });
    return {
      enabled: false,
      agentName: null,
      activeVoiceParticipantCount: 0,
      ignoredParticipantIdentity,
      existingDispatchCount: 0,
      deletedDispatchCount: 0,
      removedAgentCount: 0,
      roomFound: false,
      released: false,
    };
  }

  const resolvedCredentials: LivekitDispatchCredentials = options?.credentials ?? {
    livekitUrl: requireEnv("LIVEKIT_URL"),
    livekitApiKey: requireEnv("LIVEKIT_API_KEY"),
    livekitApiSecret: requireEnv("LIVEKIT_API_SECRET"),
  };
  const agentName = getTranscriberAgentName();
  const roomClient = createRoomServiceClient(resolvedCredentials);
  const dispatchClient = createDispatchClient(resolvedCredentials);

  let participants: ParticipantInfo[];
  try {
    participants = await roomClient.listParticipants(roomId);
  } catch (error) {
    if (isTwirpCode(error, "not_found")) {
      logDispatch("Skip release because room is missing", { roomId, ignoredParticipantIdentity });
      return {
        enabled: true,
        agentName,
        activeVoiceParticipantCount: 0,
        ignoredParticipantIdentity,
        existingDispatchCount: 0,
        deletedDispatchCount: 0,
        removedAgentCount: 0,
        roomFound: false,
        released: false,
      };
    }
    throw error;
  }

  const activeVoiceParticipants = participants.filter((participant) =>
    hasActiveMicrophoneTrack(participant, ignoredParticipantIdentity),
  );
  if (activeVoiceParticipants.length > 0) {
    logDispatch("Skip release because voice participants are still active", {
      roomId,
      ignoredParticipantIdentity,
      activeVoiceParticipantCount: activeVoiceParticipants.length,
      activeVoiceParticipantIdentities: activeVoiceParticipants.map((participant) => participant.identity),
    });
    return {
      enabled: true,
      agentName,
      activeVoiceParticipantCount: activeVoiceParticipants.length,
      ignoredParticipantIdentity,
      existingDispatchCount: 0,
      deletedDispatchCount: 0,
      removedAgentCount: 0,
      roomFound: true,
      released: false,
    };
  }

  const existingDispatches = await dispatchClient.listDispatch(roomId);
  const transcriberDispatches = existingDispatches.filter((dispatch) => dispatch.agentName === agentName);

  let deletedDispatchCount = 0;
  for (const dispatch of transcriberDispatches) {
    if (!dispatch.id) {
      continue;
    }

    try {
      await dispatchClient.deleteDispatch(dispatch.id, roomId);
      deletedDispatchCount += 1;
    } catch (error) {
      if (!isTwirpCode(error, "not_found")) {
        throw error;
      }
    }
  }

  const agentParticipants = participants.filter(
    (participant) => participant.kind === LIVEKIT_AGENT_PARTICIPANT_KIND,
  );
  let removedAgentCount = 0;
  for (const participant of agentParticipants) {
    try {
      await roomClient.removeParticipant(roomId, participant.identity);
      removedAgentCount += 1;
    } catch (error) {
      if (!isTwirpCode(error, "not_found")) {
        throw error;
      }
    }
  }

  logDispatch("Released transcriber dispatch after last voice participant left", {
    roomId,
    ignoredParticipantIdentity,
    existingDispatchCount: existingDispatches.length,
    deletedDispatchCount,
    removedAgentCount,
  });

  return {
    enabled: true,
    agentName,
    activeVoiceParticipantCount: 0,
    ignoredParticipantIdentity,
    existingDispatchCount: existingDispatches.length,
    deletedDispatchCount,
    removedAgentCount,
    roomFound: true,
    released: deletedDispatchCount > 0 || removedAgentCount > 0,
  };
}
