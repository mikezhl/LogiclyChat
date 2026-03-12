import { UserLivekitCredentials } from "@prisma/client";

import { getUserProviderKeysMode, optionalEnv, requireEnv } from "./env";
import { type KeySource } from "./provider-sources";
import { prisma } from "./prisma";
import {
  decryptOptionalSecret,
  encryptSecretValue,
  maskSecret,
  normalizeSecret,
} from "./secret-utils";

export type UserLivekitCredentialPayload = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

export type UserLivekitCredentialStatus = {
  configured: boolean;
  livekitUrlMask: string | null;
  livekitApiKeyMask: string | null;
  livekitApiSecretMask: string | null;
};

export type ResolvedLivekitCredentials = {
  livekitUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  source: KeySource;
  livekitApiKeyMask: string | null;
  configured: boolean;
};

type NormalizedLivekitCredentials = {
  livekitUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
};

type CompleteLivekitCredentials = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

const EMPTY_LIVEKIT_CREDENTIALS: NormalizedLivekitCredentials = {
  livekitUrl: null,
  livekitApiKey: null,
  livekitApiSecret: null,
};

function normalizeLivekitCredentials(payload: {
  livekitUrl?: string | null;
  livekitApiKey?: string | null;
  livekitApiSecret?: string | null;
}): NormalizedLivekitCredentials {
  return {
    livekitUrl: normalizeSecret(payload.livekitUrl),
    livekitApiKey: normalizeSecret(payload.livekitApiKey),
    livekitApiSecret: normalizeSecret(payload.livekitApiSecret),
  };
}

function normalizeLivekitCredentialsFromRecord(
  record: UserLivekitCredentials,
): NormalizedLivekitCredentials {
  return normalizeLivekitCredentials({
    livekitUrl: decryptOptionalSecret(record.livekitUrlEncrypted),
    livekitApiKey: decryptOptionalSecret(record.livekitApiKeyEncrypted),
    livekitApiSecret: decryptOptionalSecret(record.livekitApiSecretEncrypted),
  });
}

function hasAnyLivekitCredentialValue(keys: NormalizedLivekitCredentials) {
  return Boolean(keys.livekitUrl || keys.livekitApiKey || keys.livekitApiSecret);
}

function hasCompleteLivekitCredentials(
  keys: NormalizedLivekitCredentials,
): keys is CompleteLivekitCredentials {
  return Boolean(keys.livekitUrl && keys.livekitApiKey && keys.livekitApiSecret);
}

function getSystemLivekitCredentials() {
  return normalizeLivekitCredentials({
    livekitUrl: optionalEnv("LIVEKIT_URL"),
    livekitApiKey: optionalEnv("LIVEKIT_API_KEY"),
    livekitApiSecret: optionalEnv("LIVEKIT_API_SECRET"),
  });
}

function toUserLivekitCredentialStatus(
  record: UserLivekitCredentials | null,
): UserLivekitCredentialStatus {
  if (!record) {
    return {
      configured: false,
      livekitUrlMask: null,
      livekitApiKeyMask: null,
      livekitApiSecretMask: null,
    };
  }

  const credentials = normalizeLivekitCredentialsFromRecord(record);
  return {
    configured: hasCompleteLivekitCredentials(credentials),
    livekitUrlMask: maskSecret(credentials.livekitUrl),
    livekitApiKeyMask: maskSecret(credentials.livekitApiKey),
    livekitApiSecretMask: maskSecret(credentials.livekitApiSecret),
  };
}

export async function getUserLivekitCredentialStatus(
  userId: string,
): Promise<UserLivekitCredentialStatus> {
  const record = await prisma.userLivekitCredentials.findUnique({
    where: { userId },
  });
  return toUserLivekitCredentialStatus(record);
}

export async function upsertUserLivekitCredentials(
  userId: string,
  payload: UserLivekitCredentialPayload | null,
) {
  if (!payload) {
    await prisma.userLivekitCredentials.deleteMany({
      where: { userId },
    });
    return getUserLivekitCredentialStatus(userId);
  }

  const normalizedCredentials = normalizeLivekitCredentials(payload);
  if (!hasCompleteLivekitCredentials(normalizedCredentials)) {
    throw new Error("livekitUrl, livekitApiKey and livekitApiSecret are required");
  }

  await prisma.userLivekitCredentials.upsert({
    where: { userId },
    create: {
      userId,
      livekitUrlEncrypted: encryptSecretValue(normalizedCredentials.livekitUrl),
      livekitApiKeyEncrypted: encryptSecretValue(normalizedCredentials.livekitApiKey),
      livekitApiSecretEncrypted: encryptSecretValue(normalizedCredentials.livekitApiSecret),
    },
    update: {
      livekitUrlEncrypted: encryptSecretValue(normalizedCredentials.livekitUrl),
      livekitApiKeyEncrypted: encryptSecretValue(normalizedCredentials.livekitApiKey),
      livekitApiSecretEncrypted: encryptSecretValue(normalizedCredentials.livekitApiSecret),
    },
  });

  return getUserLivekitCredentialStatus(userId);
}

export function getRequiredSystemLivekitCredentials(): CompleteLivekitCredentials {
  return {
    livekitUrl: requireEnv("LIVEKIT_URL"),
    livekitApiKey: requireEnv("LIVEKIT_API_KEY"),
    livekitApiSecret: requireEnv("LIVEKIT_API_SECRET"),
  };
}

export function resolvePlatformLivekitCredentials(): ResolvedLivekitCredentials {
  const systemCredentials = getSystemLivekitCredentials();
  const configured = hasCompleteLivekitCredentials(systemCredentials);
  return {
    livekitUrl: configured ? systemCredentials.livekitUrl : null,
    livekitApiKey: configured ? systemCredentials.livekitApiKey : null,
    livekitApiSecret: configured ? systemCredentials.livekitApiSecret : null,
    source: configured ? "system" : "unavailable",
    livekitApiKeyMask: null,
    configured,
  };
}

export async function resolveUserOwnedLivekitCredentials(
  userId: string | null | undefined,
): Promise<ResolvedLivekitCredentials> {
  if (!userId) {
    return {
      livekitUrl: null,
      livekitApiKey: null,
      livekitApiSecret: null,
      source: "unavailable",
      livekitApiKeyMask: null,
      configured: false,
    };
  }

  const record = await prisma.userLivekitCredentials.findUnique({
    where: { userId },
  });
  if (!record) {
    return {
      livekitUrl: null,
      livekitApiKey: null,
      livekitApiSecret: null,
      source: "unavailable",
      livekitApiKeyMask: null,
      configured: false,
    };
  }

  try {
    const userCredentials = normalizeLivekitCredentialsFromRecord(record);
    const configured = hasCompleteLivekitCredentials(userCredentials);
    return {
      livekitUrl: configured ? userCredentials.livekitUrl : null,
      livekitApiKey: configured ? userCredentials.livekitApiKey : null,
      livekitApiSecret: configured ? userCredentials.livekitApiSecret : null,
      source: configured ? "user" : "unavailable",
      livekitApiKeyMask: configured ? maskSecret(userCredentials.livekitApiKey) : null,
      configured,
    };
  } catch (error) {
    console.error("Failed to decrypt user LiveKit credentials", {
      userId,
      error: error instanceof Error ? error.message : error,
    });
    return {
      livekitUrl: null,
      livekitApiKey: null,
      livekitApiSecret: null,
      source: "unavailable",
      livekitApiKeyMask: null,
      configured: false,
    };
  }
}

export async function resolveLivekitCredentialsForOwner(
  ownerUserId: string | null | undefined,
): Promise<ResolvedLivekitCredentials> {
  const mode = getUserProviderKeysMode();
  const canUseSystemCredentials = mode !== "full";
  const canUseUserCredentials = mode !== "false";

  const systemCredentials = canUseSystemCredentials ? getSystemLivekitCredentials() : EMPTY_LIVEKIT_CREDENTIALS;
  const hasCompleteSystemCredentials = hasCompleteLivekitCredentials(systemCredentials);

  let livekitUrl = hasCompleteSystemCredentials ? systemCredentials.livekitUrl : null;
  let livekitApiKey = hasCompleteSystemCredentials ? systemCredentials.livekitApiKey : null;
  let livekitApiSecret = hasCompleteSystemCredentials ? systemCredentials.livekitApiSecret : null;
  let source: KeySource = hasCompleteSystemCredentials ? "system" : "unavailable";

  const setUnavailable = () => {
    livekitUrl = null;
    livekitApiKey = null;
    livekitApiSecret = null;
    source = "unavailable";
  };

  if (canUseUserCredentials && ownerUserId) {
    const record = await prisma.userLivekitCredentials.findUnique({ where: { userId: ownerUserId } });

    if (record) {
      try {
        const userCredentials = normalizeLivekitCredentialsFromRecord(record);
        if (hasCompleteLivekitCredentials(userCredentials)) {
          livekitUrl = userCredentials.livekitUrl;
          livekitApiKey = userCredentials.livekitApiKey;
          livekitApiSecret = userCredentials.livekitApiSecret;
          source = "user";
        } else if (hasAnyLivekitCredentialValue(userCredentials) && !hasCompleteSystemCredentials) {
          setUnavailable();
        } else if (!hasCompleteSystemCredentials && mode === "full") {
          setUnavailable();
        }
      } catch (error) {
        console.error("Failed to decrypt user LiveKit credentials", {
          ownerUserId,
          mode,
          error: error instanceof Error ? error.message : error,
        });

        if (!hasCompleteSystemCredentials) {
          setUnavailable();
        }
      }
    } else if (!hasCompleteSystemCredentials && mode === "full") {
      setUnavailable();
    }
  } else if (!hasCompleteSystemCredentials) {
    setUnavailable();
  }

  return {
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    source,
    livekitApiKeyMask: source === "user" ? maskSecret(livekitApiKey) : null,
    configured: Boolean(livekitUrl && livekitApiKey && livekitApiSecret),
  };
}
