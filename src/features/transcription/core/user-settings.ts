import {
  UserProviderPreference,
  UserTranscriptionProviderCredential,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  decryptOptionalSecret,
  encryptSecretValue,
  maskSecret,
  normalizeSecret,
} from "@/lib/secret-utils";
import {
  fromPrismaTranscriptionProvider,
  getTranscriptionApiKeyValidationError,
  getSupportedTranscriptionProviders,
  isValidTranscriptionApiKey,
  parseTranscriptionProviderName,
  toPrismaTranscriptionProvider,
  type TranscriptionProviderName,
} from "./providers";

export type TranscriptionProviderCredentialInput = {
  apiKey: string;
};

export type UserTranscriptionProviderStatus = {
  provider: TranscriptionProviderName;
  configured: boolean;
  credentialMask: string | null;
};

export type UserTranscriptionSettingsStatus = {
  defaultProvider: TranscriptionProviderName | null;
  providers: UserTranscriptionProviderStatus[];
};

type StoredCredentialConfig = {
  apiKey: string | null;
};

function normalizeProviderCredentialInput(payload: {
  apiKey?: string | null;
}): StoredCredentialConfig {
  return {
    apiKey: normalizeSecret(payload.apiKey),
  };
}

function parseStoredCredentialConfig(
  record: UserTranscriptionProviderCredential,
): StoredCredentialConfig {
  const decrypted = decryptOptionalSecret(record.configEncrypted);
  if (!decrypted) {
    return { apiKey: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    throw new Error("Invalid transcription provider credential payload");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid transcription provider credential payload");
  }

  const value = parsed as { apiKey?: string | null };
  return normalizeProviderCredentialInput({
    apiKey: value.apiKey,
  });
}

function buildProviderStatusMap(
  credentialRecords: UserTranscriptionProviderCredential[],
): Map<TranscriptionProviderName, UserTranscriptionProviderStatus> {
  const statusMap = new Map<TranscriptionProviderName, UserTranscriptionProviderStatus>();

  for (const provider of getSupportedTranscriptionProviders()) {
    statusMap.set(provider, {
      provider,
      configured: false,
      credentialMask: null,
    });
  }

  for (const record of credentialRecords) {
    const provider = fromPrismaTranscriptionProvider(record.provider);
    try {
      const config = parseStoredCredentialConfig(record);
      statusMap.set(provider, {
        provider,
        configured: isValidTranscriptionApiKey(provider, config.apiKey),
        credentialMask: maskSecret(config.apiKey),
      });
    } catch (error) {
      console.error("Failed to parse transcription provider credentials", {
        provider,
        error: error instanceof Error ? error.message : error,
      });
      statusMap.set(provider, {
        provider,
        configured: false,
        credentialMask: null,
      });
    }
  }

  return statusMap;
}

async function getPreferenceRecord(userId: string): Promise<UserProviderPreference | null> {
  return prisma.userProviderPreference.findUnique({
    where: { userId },
  });
}

export async function getUserTranscriptionSettingsStatus(
  userId: string,
): Promise<UserTranscriptionSettingsStatus> {
  const [preference, credentials] = await Promise.all([
    getPreferenceRecord(userId),
    prisma.userTranscriptionProviderCredential.findMany({
      where: { userId },
      orderBy: { provider: "asc" },
    }),
  ]);

  const statusMap = buildProviderStatusMap(credentials);
  return {
    defaultProvider: preference?.defaultTranscriptionProvider
      ? fromPrismaTranscriptionProvider(preference.defaultTranscriptionProvider)
      : null,
    providers: getSupportedTranscriptionProviders().map((provider) => statusMap.get(provider)!),
  };
}

export async function saveUserTranscriptionProviderCredentials(
  userId: string,
  provider: TranscriptionProviderName,
  payload: TranscriptionProviderCredentialInput,
) {
  const normalized = normalizeProviderCredentialInput(payload);
  const validationError = getTranscriptionApiKeyValidationError(provider, normalized.apiKey);
  if (validationError) {
    throw new Error(validationError);
  }

  await prisma.userTranscriptionProviderCredential.upsert({
    where: {
      userId_provider: {
        userId,
        provider: toPrismaTranscriptionProvider(provider),
      },
    },
    create: {
      userId,
      provider: toPrismaTranscriptionProvider(provider),
      configEncrypted: encryptSecretValue(JSON.stringify(normalized)),
    },
    update: {
      configEncrypted: encryptSecretValue(JSON.stringify(normalized)),
    },
  });

  return getUserTranscriptionSettingsStatus(userId);
}

export async function clearUserTranscriptionProviderCredentials(
  userId: string,
  provider: TranscriptionProviderName,
) {
  await prisma.userTranscriptionProviderCredential.deleteMany({
    where: {
      userId,
      provider: toPrismaTranscriptionProvider(provider),
    },
  });

  const preference = await getPreferenceRecord(userId);
  if (
    preference?.defaultTranscriptionProvider &&
    fromPrismaTranscriptionProvider(preference.defaultTranscriptionProvider) === provider
  ) {
    await prisma.userProviderPreference.upsert({
      where: { userId },
      create: {
        userId,
        defaultTranscriptionProvider: null,
      },
      update: {
        defaultTranscriptionProvider: null,
      },
    });
  }

  return getUserTranscriptionSettingsStatus(userId);
}

export async function setUserDefaultTranscriptionProvider(
  userId: string,
  provider: TranscriptionProviderName | null,
) {
  if (provider) {
    const status = await getUserTranscriptionSettingsStatus(userId);
    const target = status.providers.find((item) => item.provider === provider);
    if (!target?.configured) {
      throw new Error(`Provider ${provider} is not configured`);
    }
  }

  await prisma.userProviderPreference.upsert({
    where: { userId },
    create: {
      userId,
      defaultTranscriptionProvider: provider ? toPrismaTranscriptionProvider(provider) : null,
    },
    update: {
      defaultTranscriptionProvider: provider ? toPrismaTranscriptionProvider(provider) : null,
    },
  });

  return getUserTranscriptionSettingsStatus(userId);
}

export async function getUserDefaultTranscriptionProvider(
  userId: string,
): Promise<TranscriptionProviderName | null> {
  const preference = await getPreferenceRecord(userId);
  return preference?.defaultTranscriptionProvider
    ? fromPrismaTranscriptionProvider(preference.defaultTranscriptionProvider)
    : null;
}

export async function getStoredUserTranscriptionProviderCredentials(
  userId: string,
): Promise<Map<TranscriptionProviderName, StoredCredentialConfig>> {
  const records = await prisma.userTranscriptionProviderCredential.findMany({
    where: { userId },
  });

  const result = new Map<TranscriptionProviderName, StoredCredentialConfig>();
  for (const record of records) {
    const provider = fromPrismaTranscriptionProvider(record.provider);
    try {
      result.set(provider, parseStoredCredentialConfig(record));
    } catch (error) {
      console.error("Failed to parse stored transcription provider credentials", {
        userId,
        provider,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
  return result;
}

export function normalizeRequestedDefaultProvider(
  value: string | null | undefined,
): TranscriptionProviderName | null {
  return parseTranscriptionProviderName(value);
}
