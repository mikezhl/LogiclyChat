import { UserProviderKeys } from "@prisma/client";

import { getUserProviderKeysMode, optionalEnv, requireEnv } from "./env";
import { prisma } from "./prisma";
import {
  decryptOptionalSecret,
  encryptSecretValue,
  maskSecret,
  normalizeSecret,
} from "./secret-utils";

export type KeySource = "user" | "system" | "unavailable";

export type UserKeyPayload = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  deepgramApiKey: string;
};

export type UserKeyStatus = {
  configured: boolean;
  livekitUrlMask: string | null;
  livekitApiKeyMask: string | null;
  livekitApiSecretMask: string | null;
  deepgramApiKeyMask: string | null;
};

export type ResolvedProviderCredentials = {
  livekitUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  deepgramApiKey: string | null;
  livekitSource: KeySource;
  deepgramSource: KeySource;
  livekitApiKeyMask: string | null;
  deepgramApiKeyMask: string | null;
};

type NormalizedUserKeys = {
  livekitUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  deepgramApiKey: string | null;
};

type CompleteUserKeys = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  deepgramApiKey: string;
};

function normalizeUserKeys(payload: {
  livekitUrl?: string | null;
  livekitApiKey?: string | null;
  livekitApiSecret?: string | null;
  deepgramApiKey?: string | null;
}): NormalizedUserKeys {
  return {
    livekitUrl: normalizeSecret(payload.livekitUrl),
    livekitApiKey: normalizeSecret(payload.livekitApiKey),
    livekitApiSecret: normalizeSecret(payload.livekitApiSecret),
    deepgramApiKey: normalizeSecret(payload.deepgramApiKey),
  };
}

function hasAnyUserKeyValue(keys: NormalizedUserKeys) {
  return Boolean(
    keys.livekitUrl || keys.livekitApiKey || keys.livekitApiSecret || keys.deepgramApiKey,
  );
}

function hasCompleteUserKeySet(keys: NormalizedUserKeys): keys is CompleteUserKeys {
  return Boolean(
    keys.livekitUrl && keys.livekitApiKey && keys.livekitApiSecret && keys.deepgramApiKey,
  );
}

function toUserKeyStatus(record: UserProviderKeys | null): UserKeyStatus {
  if (!record) {
    return {
      configured: false,
      livekitUrlMask: null,
      livekitApiKeyMask: null,
      livekitApiSecretMask: null,
      deepgramApiKeyMask: null,
    };
  }

  const normalizedKeys = normalizeUserKeys({
    livekitUrl: decryptOptionalSecret(record.livekitUrlEncrypted),
    livekitApiKey: decryptOptionalSecret(record.livekitApiKeyEncrypted),
    livekitApiSecret: decryptOptionalSecret(record.livekitApiSecretEncrypted),
    deepgramApiKey: decryptOptionalSecret(record.deepgramApiKeyEncrypted),
  });

  return {
    configured: hasCompleteUserKeySet(normalizedKeys),
    livekitUrlMask: maskSecret(normalizedKeys.livekitUrl),
    livekitApiKeyMask: maskSecret(normalizedKeys.livekitApiKey),
    livekitApiSecretMask: maskSecret(normalizedKeys.livekitApiSecret),
    deepgramApiKeyMask: maskSecret(normalizedKeys.deepgramApiKey),
  };
}

export async function getUserKeyStatus(userId: string): Promise<UserKeyStatus> {
  const record = await prisma.userProviderKeys.findUnique({
    where: { userId },
  });
  return toUserKeyStatus(record);
}

export async function upsertUserKeys(userId: string, payload: UserKeyPayload | null) {
  if (!payload) {
    await prisma.userProviderKeys.deleteMany({
      where: { userId },
    });
    return getUserKeyStatus(userId);
  }

  const normalizedKeys = normalizeUserKeys(payload);
  if (!hasCompleteUserKeySet(normalizedKeys)) {
    throw new Error(
      "livekitUrl, livekitApiKey, livekitApiSecret and deepgramApiKey are required",
    );
  }

  await prisma.userProviderKeys.upsert({
    where: { userId },
    create: {
      userId,
      livekitUrlEncrypted: encryptSecretValue(normalizedKeys.livekitUrl),
      livekitApiKeyEncrypted: encryptSecretValue(normalizedKeys.livekitApiKey),
      livekitApiSecretEncrypted: encryptSecretValue(normalizedKeys.livekitApiSecret),
      deepgramApiKeyEncrypted: encryptSecretValue(normalizedKeys.deepgramApiKey),
    },
    update: {
      livekitUrlEncrypted: encryptSecretValue(normalizedKeys.livekitUrl),
      livekitApiKeyEncrypted: encryptSecretValue(normalizedKeys.livekitApiKey),
      livekitApiSecretEncrypted: encryptSecretValue(normalizedKeys.livekitApiSecret),
      deepgramApiKeyEncrypted: encryptSecretValue(normalizedKeys.deepgramApiKey),
    },
  });

  return getUserKeyStatus(userId);
}

export async function resolveProviderCredentialsForOwner(
  ownerUserId: string | null | undefined,
): Promise<ResolvedProviderCredentials> {
  const mode = getUserProviderKeysMode();

  const canUseSystemKeys = mode !== "full";
  const canUseUserKeys = mode !== "false";

  const defaultLivekitUrl = canUseSystemKeys ? requireEnv("LIVEKIT_URL") : null;
  const defaultLivekitApiKey = canUseSystemKeys ? requireEnv("LIVEKIT_API_KEY") : null;
  const defaultLivekitApiSecret = canUseSystemKeys ? requireEnv("LIVEKIT_API_SECRET") : null;
  const defaultDeepgramApiKey = canUseSystemKeys ? optionalEnv("DEEPGRAM_API_KEY") : null;

  let livekitUrl = defaultLivekitUrl;
  let livekitApiKey = defaultLivekitApiKey;
  let livekitApiSecret = defaultLivekitApiSecret;
  let deepgramApiKey = defaultDeepgramApiKey;
  let livekitSource: KeySource = canUseSystemKeys ? "system" : "unavailable";
  let deepgramSource: KeySource = defaultDeepgramApiKey ? "system" : "unavailable";
  const setCredentialsUnavailable = () => {
    livekitUrl = null;
    livekitApiKey = null;
    livekitApiSecret = null;
    deepgramApiKey = null;
    livekitSource = "unavailable";
    deepgramSource = "unavailable";
  };

  if (canUseUserKeys && ownerUserId) {
    const record = await prisma.userProviderKeys.findUnique({
      where: { userId: ownerUserId },
    });

    if (record) {
      try {
        const userKeys = normalizeUserKeys({
          livekitUrl: decryptOptionalSecret(record.livekitUrlEncrypted),
          livekitApiKey: decryptOptionalSecret(record.livekitApiKeyEncrypted),
          livekitApiSecret: decryptOptionalSecret(record.livekitApiSecretEncrypted),
          deepgramApiKey: decryptOptionalSecret(record.deepgramApiKeyEncrypted),
        });

        if (hasCompleteUserKeySet(userKeys)) {
          livekitUrl = userKeys.livekitUrl;
          livekitApiKey = userKeys.livekitApiKey;
          livekitApiSecret = userKeys.livekitApiSecret;
          deepgramApiKey = userKeys.deepgramApiKey;
          livekitSource = "user";
          deepgramSource = "user";
        } else if (hasAnyUserKeyValue(userKeys)) {
          console.warn("Ignoring incomplete user provider keys", {
            ownerUserId,
            mode,
            hasLivekitUrl: Boolean(userKeys.livekitUrl),
            hasLivekitApiKey: Boolean(userKeys.livekitApiKey),
            hasLivekitApiSecret: Boolean(userKeys.livekitApiSecret),
            hasDeepgramApiKey: Boolean(userKeys.deepgramApiKey),
          });
          if (!canUseSystemKeys) {
            setCredentialsUnavailable();
          }
        } else if (!canUseSystemKeys) {
          setCredentialsUnavailable();
        }
      } catch (error) {
        console.error("Failed to decrypt user provider keys", {
          ownerUserId,
          mode,
          error: error instanceof Error ? error.message : error,
        });

        if (!canUseSystemKeys) {
          setCredentialsUnavailable();
        }
      }
    } else if (!canUseSystemKeys) {
      setCredentialsUnavailable();
    }
  }

  return {
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    deepgramApiKey,
    livekitSource,
    deepgramSource,
    livekitApiKeyMask: livekitSource === "user" ? maskSecret(livekitApiKey) : null,
    deepgramApiKeyMask: deepgramSource === "user" ? maskSecret(deepgramApiKey) : null,
  };
}
