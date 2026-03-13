type EnvKey =
  | "DATABASE_URL"
  | "LIVEKIT_URL"
  | "LIVEKIT_API_KEY"
  | "LIVEKIT_API_SECRET"
  | "LIVEKIT_TRANSCRIBER_ENABLED"
  | "LIVEKIT_TRANSCRIBER_AGENT_NAME"
  | "DEEPGRAM_API_KEY"
  | "DEEPGRAM_MODEL"
  | "DEEPGRAM_LANGUAGE"
  | "DEEPGRAM_INTERIM_RESULTS"
  | "DEEPGRAM_PUNCTUATE"
  | "DEEPGRAM_SMART_FORMAT"
  | "DEEPGRAM_ENDPOINTING"
  | "DEEPGRAM_PROFANITY_FILTER"
  | "DEEPGRAM_FILLER_WORDS"
  | "DEEPGRAM_NUMERALS"
  | "DEEPGRAM_DETECT_LANGUAGE"
  | "DEEPGRAM_NO_DELAY"
  | "DEEPGRAM_DIARIZE"
  | "DEEPGRAM_DICTATION"
  | "DEEPGRAM_SAMPLE_RATE"
  | "DEEPGRAM_NUM_CHANNELS"
  | "DEEPGRAM_MIP_OPT_OUT"
  | "TRANSCRIPTION_PROVIDER"
  | "DASHSCOPE_API_KEY"
  | "DASHSCOPE_REALTIME_URL"
  | "DASHSCOPE_REALTIME_MODEL"
  | "DASHSCOPE_REALTIME_LANGUAGE"
  | "DASHSCOPE_REALTIME_AUDIO_FORMAT"
  | "DASHSCOPE_REALTIME_SAMPLE_RATE"
  | "DASHSCOPE_REALTIME_SERVER_VAD"
  | "DASHSCOPE_REALTIME_SILENCE_DURATION_MS"
  | "CONVERSATION_LLM_PROVIDER"
  | "CONVERSATION_LLM_OPENAI_BASE_URL"
  | "CONVERSATION_LLM_OPENAI_API_KEY"
  | "CONVERSATION_LLM_OPENAI_MODEL"
  | "PLATFORM_TRANSCRIPTION_LIMIT_MINUTES_PER_USER"
  | "PLATFORM_LLM_LIMIT_TOKENS_PER_USER"
  | "APP_ENCRYPTION_SECRET"
  | "SESSION_TTL_HOURS"
  | "USER_PROVIDER_KEYS_MODE"
  | "ROOM_SPEAKER_SWITCH_ENABLED";

export type UserProviderKeysMode = "false" | "true" | "full";

export function requireEnv(key: EnvKey): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function optionalEnv(key: EnvKey): string | null {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

export function getUserProviderKeysMode(): UserProviderKeysMode {
  const raw = optionalEnv("USER_PROVIDER_KEYS_MODE")?.toLowerCase();
  if (raw === "false" || raw === "true" || raw === "full") {
    return raw;
  }

  return "true";
}

export function isRoomSpeakerSwitchEnabled(): boolean {
  return parseBooleanEnv(optionalEnv("ROOM_SPEAKER_SWITCH_ENABLED"), false);
}

function normalizePositiveLimit(value: number) {
  return value > 0 ? value : null;
}

export function getPlatformTranscriptionLimitMinutesPerUser(): number | null {
  const limit = parseIntegerEnv(optionalEnv("PLATFORM_TRANSCRIPTION_LIMIT_MINUTES_PER_USER"), 120);
  return normalizePositiveLimit(limit);
}

export function getPlatformLlmLimitTokensPerUser(): number | null {
  const limit = parseIntegerEnv(optionalEnv("PLATFORM_LLM_LIMIT_TOKENS_PER_USER"), 5_000_000);
  return normalizePositiveLimit(limit);
}

export function parseBooleanEnv(value: string | null | undefined, fallback: boolean) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

export function parseIntegerEnv(value: string | null | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
