import { UserLlmKeys } from "@prisma/client";

import { getUserProviderKeysMode, optionalEnv } from "./env";
import { type KeySource } from "./provider-sources";
import { prisma } from "./prisma";
import {
  decryptOptionalSecret,
  encryptSecretValue,
  maskSecret,
  normalizeSecret,
} from "./secret-utils";

export type ConversationLlmProviderName = "mock" | "openai-compatible";
export type RuntimeSource = KeySource | "builtin";

export type UserLlmKeyPayload = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type UserLlmKeyStatus = {
  configured: boolean;
  baseUrlMask: string | null;
  apiKeyMask: string | null;
  model: string | null;
};

export type ResolvedConversationLlmRuntime = {
  provider: ConversationLlmProviderName;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  source: RuntimeSource;
  apiKeyMask: string | null;
  configured: boolean;
};

type NormalizedUserLlmKeys = {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
};

type CompleteUserLlmKeys = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const EMPTY_LLM_KEYS: NormalizedUserLlmKeys = {
  baseUrl: null,
  apiKey: null,
  model: null,
};

function normalizeUserLlmKeys(payload: {
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
}): NormalizedUserLlmKeys {
  return {
    baseUrl: normalizeSecret(payload.baseUrl),
    apiKey: normalizeSecret(payload.apiKey),
    model: normalizeSecret(payload.model),
  };
}

function normalizeUserLlmKeysFromRecord(record: UserLlmKeys): NormalizedUserLlmKeys {
  return normalizeUserLlmKeys({
    baseUrl: decryptOptionalSecret(record.baseUrlEncrypted),
    apiKey: decryptOptionalSecret(record.apiKeyEncrypted),
    model: decryptOptionalSecret(record.modelEncrypted),
  });
}

function hasAnyUserLlmValue(keys: NormalizedUserLlmKeys) {
  return Boolean(keys.baseUrl || keys.apiKey || keys.model);
}

function hasCompleteUserLlmSet(keys: NormalizedUserLlmKeys): keys is CompleteUserLlmKeys {
  return Boolean(keys.baseUrl && keys.apiKey && keys.model);
}

function toUserLlmKeyStatus(record: UserLlmKeys | null): UserLlmKeyStatus {
  if (!record) {
    return {
      configured: false,
      baseUrlMask: null,
      apiKeyMask: null,
      model: null,
    };
  }

  const normalizedKeys = normalizeUserLlmKeysFromRecord(record);
  return {
    configured: hasCompleteUserLlmSet(normalizedKeys),
    baseUrlMask: maskSecret(normalizedKeys.baseUrl),
    apiKeyMask: maskSecret(normalizedKeys.apiKey),
    model: normalizedKeys.model,
  };
}

function getSystemLlmKeys() {
  return normalizeUserLlmKeys({
    baseUrl: optionalEnv("CONVERSATION_LLM_OPENAI_BASE_URL"),
    apiKey: optionalEnv("CONVERSATION_LLM_OPENAI_API_KEY"),
    model: optionalEnv("CONVERSATION_LLM_OPENAI_MODEL"),
  });
}

export function getConversationLlmProviderName(): ConversationLlmProviderName {
  const raw = optionalEnv("CONVERSATION_LLM_PROVIDER")?.toLowerCase() ?? "mock";
  if (raw === "mock") {
    return "mock";
  }
  if (raw === "openai-compatible" || raw === "openai" || raw === "real") {
    return "openai-compatible";
  }

  throw new Error(`Unsupported CONVERSATION_LLM_PROVIDER: ${raw}`);
}

export async function getUserLlmKeyStatus(userId: string): Promise<UserLlmKeyStatus> {
  const record = await prisma.userLlmKeys.findUnique({
    where: { userId },
  });

  return toUserLlmKeyStatus(record);
}

export async function upsertUserLlmKeys(userId: string, payload: UserLlmKeyPayload | null) {
  if (!payload) {
    await prisma.userLlmKeys.deleteMany({
      where: { userId },
    });
    return getUserLlmKeyStatus(userId);
  }

  const normalizedKeys = normalizeUserLlmKeys(payload);
  if (!hasCompleteUserLlmSet(normalizedKeys)) {
    throw new Error("baseUrl, apiKey and model are required");
  }

  await prisma.userLlmKeys.upsert({
    where: { userId },
    create: {
      userId,
      baseUrlEncrypted: encryptSecretValue(normalizedKeys.baseUrl),
      apiKeyEncrypted: encryptSecretValue(normalizedKeys.apiKey),
      modelEncrypted: encryptSecretValue(normalizedKeys.model),
    },
    update: {
      baseUrlEncrypted: encryptSecretValue(normalizedKeys.baseUrl),
      apiKeyEncrypted: encryptSecretValue(normalizedKeys.apiKey),
      modelEncrypted: encryptSecretValue(normalizedKeys.model),
    },
  });

  return getUserLlmKeyStatus(userId);
}

export async function resolveConversationLlmRuntimeForOwner(
  ownerUserId: string | null | undefined,
): Promise<ResolvedConversationLlmRuntime> {
  const provider = getConversationLlmProviderName();
  if (provider === "mock") {
    return {
      provider,
      baseUrl: null,
      apiKey: null,
      model: null,
      source: "builtin",
      apiKeyMask: null,
      configured: true,
    };
  }

  const mode = getUserProviderKeysMode();
  const canUseSystemKeys = mode !== "full";
  const canUseUserKeys = mode !== "false";

  const systemKeys = canUseSystemKeys ? getSystemLlmKeys() : EMPTY_LLM_KEYS;
  const canUseCompleteSystemKeys = hasCompleteUserLlmSet(systemKeys);

  let baseUrl = canUseCompleteSystemKeys ? systemKeys.baseUrl : null;
  let apiKey = canUseCompleteSystemKeys ? systemKeys.apiKey : null;
  let model = canUseCompleteSystemKeys ? systemKeys.model : null;
  let source: KeySource = canUseCompleteSystemKeys ? "system" : "unavailable";

  const setRuntimeUnavailable = () => {
    baseUrl = null;
    apiKey = null;
    model = null;
    source = "unavailable";
  };

  if (canUseUserKeys && ownerUserId) {
    const record = await prisma.userLlmKeys.findUnique({
      where: { userId: ownerUserId },
    });

    if (record) {
      try {
        const userKeys = normalizeUserLlmKeysFromRecord(record);

        if (hasCompleteUserLlmSet(userKeys)) {
          baseUrl = userKeys.baseUrl;
          apiKey = userKeys.apiKey;
          model = userKeys.model;
          source = "user";
        } else if (hasAnyUserLlmValue(userKeys)) {
          console.warn("Ignoring incomplete user LLM keys", {
            ownerUserId,
            mode,
            hasBaseUrl: Boolean(userKeys.baseUrl),
            hasApiKey: Boolean(userKeys.apiKey),
            hasModel: Boolean(userKeys.model),
          });
          if (!canUseCompleteSystemKeys) {
            setRuntimeUnavailable();
          }
        } else if (!canUseCompleteSystemKeys) {
          setRuntimeUnavailable();
        }
      } catch (error) {
        console.error("Failed to decrypt user LLM keys", {
          ownerUserId,
          mode,
          error: error instanceof Error ? error.message : error,
        });

        if (!canUseCompleteSystemKeys) {
          setRuntimeUnavailable();
        }
      }
    } else if (!canUseCompleteSystemKeys) {
      setRuntimeUnavailable();
    }
  }

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    source,
    apiKeyMask: source === "user" ? maskSecret(apiKey) : null,
    configured: Boolean(baseUrl && apiKey && model),
  };
}
