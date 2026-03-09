type EnvKey =
  | "DATABASE_URL"
  | "LIVEKIT_URL"
  | "LIVEKIT_API_KEY"
  | "LIVEKIT_API_SECRET"
  | "DEEPGRAM_API_KEY"
  | "CONVERSATION_LLM_PROVIDER"
  | "CONVERSATION_LLM_OPENAI_BASE_URL"
  | "CONVERSATION_LLM_OPENAI_API_KEY"
  | "CONVERSATION_LLM_OPENAI_MODEL"
  | "APP_ENCRYPTION_SECRET"
  | "SESSION_TTL_HOURS"
  | "USER_PROVIDER_KEYS_MODE";

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
