import {
  getUserProviderKeysMode,
  optionalEnv,
  parseBooleanEnv,
  parseIntegerEnv,
  type UserProviderKeysMode,
} from "@/lib/env";
import {
  resolveLivekitCredentialsForOwner,
  resolvePlatformLivekitCredentials,
  resolveUserOwnedLivekitCredentials,
  type ResolvedLivekitCredentials,
} from "@/lib/livekit-credentials";
import { type KeySource } from "@/lib/provider-sources";
import { maskSecret } from "@/lib/secret-utils";
import {
  getStoredUserTranscriptionProviderCredentials,
  getUserDefaultTranscriptionProvider,
} from "./user-settings";
import {
  isValidTranscriptionApiKey,
  parseTranscriptionProviderName,
  type TranscriptionProviderName,
} from "./providers";

export type DeepgramTranscriptionRuntime = {
  provider: "deepgram";
  apiKey: string | null;
  source: KeySource;
  configured: boolean;
  credentialMask: string | null;
  model: string;
  language: string;
  interimResults: boolean;
  punctuate: boolean;
  smartFormat: boolean;
  endpointing: number;
  profanityFilter: boolean;
  fillerWords: boolean;
  numerals: boolean;
  detectLanguage: boolean;
  noDelay: boolean;
  diarize: boolean;
  dictation: boolean;
  sampleRate: number;
  numChannels: number;
  mipOptOut: boolean;
};

export type DashScopeTranscriptionRuntime = {
  provider: "dashscope";
  apiKey: string | null;
  source: KeySource;
  configured: boolean;
  credentialMask: string | null;
  baseUrl: string;
  model: string;
  language: string;
  inputAudioFormat: string;
  sampleRate: number;
  serverVad: boolean;
  silenceDurationMs: number;
};

export type ResolvedTranscriptionRuntime =
  | DeepgramTranscriptionRuntime
  | DashScopeTranscriptionRuntime;

export type RoomVoiceRuntime = {
  livekit: ResolvedLivekitCredentials;
  transcription: ResolvedTranscriptionRuntime | null;
  transcriberEnabled: boolean;
  source: KeySource;
  ready: boolean;
  error: string | null;
};

type PlatformRuntimeOptions = {
  provider: TranscriptionProviderName;
};

type VoiceRuntimeCandidate = {
  livekit: ResolvedLivekitCredentials;
  transcription: ResolvedTranscriptionRuntime | null;
  source: KeySource;
  ready: boolean;
};

export function isTranscriberEnabled() {
  return parseBooleanEnv(optionalEnv("LIVEKIT_TRANSCRIBER_ENABLED"), true);
}

export function getTranscriberAgentName() {
  return optionalEnv("LIVEKIT_TRANSCRIBER_AGENT_NAME") ?? "transcriber";
}

export function getPlatformDefaultTranscriptionProvider(): TranscriptionProviderName {
  return parseTranscriptionProviderName(optionalEnv("TRANSCRIPTION_PROVIDER")) ?? "deepgram";
}

function buildDeepgramRuntime(
  apiKey: string | null,
  source: KeySource,
): DeepgramTranscriptionRuntime {
  const configured = isValidTranscriptionApiKey("deepgram", apiKey);
  return {
    provider: "deepgram",
    apiKey,
    source: configured ? source : "unavailable",
    configured,
    credentialMask: source === "user" ? maskSecret(apiKey) : null,
    model: optionalEnv("DEEPGRAM_MODEL") ?? "nova-2",
    language: optionalEnv("DEEPGRAM_LANGUAGE") ?? "zh",
    interimResults: parseBooleanEnv(optionalEnv("DEEPGRAM_INTERIM_RESULTS"), true),
    punctuate: parseBooleanEnv(optionalEnv("DEEPGRAM_PUNCTUATE"), true),
    smartFormat: parseBooleanEnv(optionalEnv("DEEPGRAM_SMART_FORMAT"), true),
    endpointing: parseIntegerEnv(optionalEnv("DEEPGRAM_ENDPOINTING"), 25),
    profanityFilter: parseBooleanEnv(optionalEnv("DEEPGRAM_PROFANITY_FILTER"), false),
    fillerWords: parseBooleanEnv(optionalEnv("DEEPGRAM_FILLER_WORDS"), false),
    numerals: parseBooleanEnv(optionalEnv("DEEPGRAM_NUMERALS"), false),
    detectLanguage: parseBooleanEnv(optionalEnv("DEEPGRAM_DETECT_LANGUAGE"), false),
    noDelay: parseBooleanEnv(optionalEnv("DEEPGRAM_NO_DELAY"), true),
    diarize: parseBooleanEnv(optionalEnv("DEEPGRAM_DIARIZE"), false),
    dictation: parseBooleanEnv(optionalEnv("DEEPGRAM_DICTATION"), false),
    sampleRate: parseIntegerEnv(optionalEnv("DEEPGRAM_SAMPLE_RATE"), 16000),
    numChannels: parseIntegerEnv(optionalEnv("DEEPGRAM_NUM_CHANNELS"), 1),
    mipOptOut: parseBooleanEnv(optionalEnv("DEEPGRAM_MIP_OPT_OUT"), false),
  };
}

function buildDashScopeRuntime(
  apiKey: string | null,
  source: KeySource,
): DashScopeTranscriptionRuntime {
  const configured = isValidTranscriptionApiKey("dashscope", apiKey);
  return {
    provider: "dashscope",
    apiKey,
    source: configured ? source : "unavailable",
    configured,
    credentialMask: source === "user" ? maskSecret(apiKey) : null,
    baseUrl: optionalEnv("DASHSCOPE_REALTIME_URL") ?? "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
    model: optionalEnv("DASHSCOPE_REALTIME_MODEL") ?? "qwen3-asr-flash-realtime",
    language: optionalEnv("DASHSCOPE_REALTIME_LANGUAGE") ?? "zh",
    inputAudioFormat: optionalEnv("DASHSCOPE_REALTIME_AUDIO_FORMAT") ?? "pcm",
    sampleRate: parseIntegerEnv(optionalEnv("DASHSCOPE_REALTIME_SAMPLE_RATE"), 16000),
    serverVad: parseBooleanEnv(optionalEnv("DASHSCOPE_REALTIME_SERVER_VAD"), true),
    silenceDurationMs: parseIntegerEnv(optionalEnv("DASHSCOPE_REALTIME_SILENCE_DURATION_MS"), 400),
  };
}

function buildRuntimeFromProvider(
  provider: TranscriptionProviderName,
  apiKey: string | null,
  source: KeySource,
): ResolvedTranscriptionRuntime {
  if (provider === "dashscope") {
    return buildDashScopeRuntime(apiKey, source);
  }
  return buildDeepgramRuntime(apiKey, source);
}

export function resolvePlatformTranscriptionRuntime(
  options?: PlatformRuntimeOptions,
): ResolvedTranscriptionRuntime {
  const provider = options?.provider ?? getPlatformDefaultTranscriptionProvider();
  if (provider === "dashscope") {
    return buildDashScopeRuntime(optionalEnv("DASHSCOPE_API_KEY"), "system");
  }
  return buildDeepgramRuntime(optionalEnv("DEEPGRAM_API_KEY"), "system");
}

export async function resolveUserDefaultTranscriptionRuntimeForOwner(
  ownerUserId: string | null | undefined,
): Promise<ResolvedTranscriptionRuntime | null> {
  if (!ownerUserId) {
    return null;
  }

  const [defaultProvider, credentialMap] = await Promise.all([
    getUserDefaultTranscriptionProvider(ownerUserId),
    getStoredUserTranscriptionProviderCredentials(ownerUserId),
  ]);

  if (!defaultProvider) {
    return null;
  }

  const credentials = credentialMap.get(defaultProvider);
  return buildRuntimeFromProvider(defaultProvider, credentials?.apiKey ?? null, "user");
}

function buildVoiceRuntimeCandidate(
  livekit: ResolvedLivekitCredentials,
  transcription: ResolvedTranscriptionRuntime | null,
  transcriberEnabled: boolean,
): VoiceRuntimeCandidate {
  const ready = livekit.configured && (!transcriberEnabled || Boolean(transcription?.configured));
  return {
    livekit,
    transcription,
    source: ready ? livekit.source : "unavailable",
    ready,
  };
}

function resolvePlatformVoiceRuntimeCandidate(transcriberEnabled: boolean): VoiceRuntimeCandidate {
  const livekit = resolvePlatformLivekitCredentials();
  const transcription = transcriberEnabled ? resolvePlatformTranscriptionRuntime() : null;
  return buildVoiceRuntimeCandidate(livekit, transcription, transcriberEnabled);
}

async function resolveUserVoiceRuntimeCandidate(
  ownerUserId: string | null | undefined,
  transcriberEnabled: boolean,
): Promise<VoiceRuntimeCandidate> {
  const [livekit, transcription] = await Promise.all([
    resolveUserOwnedLivekitCredentials(ownerUserId),
    transcriberEnabled ? resolveUserDefaultTranscriptionRuntimeForOwner(ownerUserId) : Promise.resolve(null),
  ]);

  return buildVoiceRuntimeCandidate(livekit, transcription, transcriberEnabled);
}

function buildVoiceRuntimeError(mode: UserProviderKeysMode, transcriberEnabled: boolean) {
  if (mode === "false") {
    return transcriberEnabled
      ? "Platform LiveKit and transcription settings must both be configured"
      : "Platform LiveKit credentials are unavailable";
  }

  if (mode === "true") {
    return transcriberEnabled
      ? "Voice runtime requires either a complete room-owner LiveKit + default transcription bundle or a complete platform LiveKit + transcription bundle"
      : "Voice runtime requires either room-owner LiveKit credentials or platform LiveKit credentials";
  }

  return transcriberEnabled
    ? "Room owner must configure LiveKit credentials and a default transcription provider with valid credentials"
    : "Room owner must configure LiveKit credentials";
}

function pickPreferredUnavailableVoiceRuntime(
  userRuntime: VoiceRuntimeCandidate,
  platformRuntime: VoiceRuntimeCandidate,
): VoiceRuntimeCandidate {
  const hasAnyUserState =
    userRuntime.livekit.source === "user" ||
    Boolean(userRuntime.livekit.livekitApiKeyMask) ||
    Boolean(userRuntime.transcription?.provider) ||
    Boolean(userRuntime.transcription?.credentialMask);

  return hasAnyUserState ? userRuntime : platformRuntime;
}

export async function resolveRoomVoiceRuntimeForOwner(
  ownerUserId: string | null | undefined,
): Promise<RoomVoiceRuntime> {
  const transcriberEnabled = isTranscriberEnabled();
  const mode = getUserProviderKeysMode();

  if (mode === "false") {
    const platformRuntime = resolvePlatformVoiceRuntimeCandidate(transcriberEnabled);
    return {
      livekit: platformRuntime.livekit,
      transcription: platformRuntime.transcription,
      transcriberEnabled,
      source: platformRuntime.source,
      ready: platformRuntime.ready,
      error: platformRuntime.ready ? null : buildVoiceRuntimeError(mode, transcriberEnabled),
    };
  }

  const userRuntime = await resolveUserVoiceRuntimeCandidate(ownerUserId, transcriberEnabled);

  if (mode === "full") {
    return {
      livekit: userRuntime.livekit,
      transcription: userRuntime.transcription,
      transcriberEnabled,
      source: userRuntime.source,
      ready: userRuntime.ready,
      error: userRuntime.ready ? null : buildVoiceRuntimeError(mode, transcriberEnabled),
    };
  }

  if (userRuntime.ready) {
    return {
      livekit: userRuntime.livekit,
      transcription: userRuntime.transcription,
      transcriberEnabled,
      source: userRuntime.source,
      ready: true,
      error: null,
    };
  }

  const platformRuntime = resolvePlatformVoiceRuntimeCandidate(transcriberEnabled);
  if (platformRuntime.ready) {
    console.info("Room voice runtime fell back to platform bundle", {
      ownerUserId,
      transcriberEnabled,
      userLivekitConfigured: userRuntime.livekit.configured,
      userTranscriptionConfigured: userRuntime.transcription?.configured ?? !transcriberEnabled,
      platformTranscriptionProvider: platformRuntime.transcription?.provider ?? null,
    });

    return {
      livekit: platformRuntime.livekit,
      transcription: platformRuntime.transcription,
      transcriberEnabled,
      source: platformRuntime.source,
      ready: true,
      error: null,
    };
  }

  const unavailableRuntime = pickPreferredUnavailableVoiceRuntime(userRuntime, platformRuntime);
  console.warn("Room voice runtime is unavailable", {
    ownerUserId,
    mode,
    transcriberEnabled,
    userLivekitConfigured: userRuntime.livekit.configured,
    userTranscriptionConfigured: userRuntime.transcription?.configured ?? !transcriberEnabled,
    platformLivekitConfigured: platformRuntime.livekit.configured,
    platformTranscriptionConfigured: platformRuntime.transcription?.configured ?? !transcriberEnabled,
  });

  return {
    livekit: unavailableRuntime.livekit,
    transcription: unavailableRuntime.transcription,
    transcriberEnabled,
    source: "unavailable",
    ready: false,
    error: buildVoiceRuntimeError(mode, transcriberEnabled),
  };
}

export async function resolveLivekitTransportForRealtimeOrThrow(
  ownerUserId: string | null | undefined,
): Promise<ResolvedLivekitCredentials> {
  const credentials = await resolveLivekitCredentialsForOwner(ownerUserId);
  if (!credentials.configured) {
    throw new Error("LiveKit credentials are unavailable");
  }
  return credentials;
}
