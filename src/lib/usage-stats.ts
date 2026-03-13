import {
  getPlatformLlmLimitTokensPerUser,
  getPlatformTranscriptionLimitMinutesPerUser,
} from "@/lib/env";
import type { RuntimeSource } from "@/lib/llm-provider-keys";
import type { KeySource } from "@/lib/provider-sources";
import { prisma } from "@/lib/prisma";

const MS_PER_SECOND = BigInt(1000);
const MS_PER_MINUTE = BigInt(60_000);

export type UserUsageCounterSnapshot = {
  voiceUserDurationMs: bigint;
  voicePlatformDurationMs: bigint;
  llmUserTokens: bigint;
  llmPlatformTokens: bigint;
};

export type UserUsageSummary = {
  voice: {
    userSeconds: number;
    platformSeconds: number;
    platformLimitSeconds: number | null;
    platformRemainingSeconds: number | null;
    platformExceeded: boolean;
  };
  llm: {
    userTokens: number;
    platformTokens: number;
    platformLimitTokens: number | null;
    platformRemainingTokens: number | null;
    platformExceeded: boolean;
  };
};

type UsageCounterField =
  | "voiceUserDurationMs"
  | "voicePlatformDurationMs"
  | "llmUserTokens"
  | "llmPlatformTokens";

const EMPTY_USAGE_COUNTER_SNAPSHOT: UserUsageCounterSnapshot = {
  voiceUserDurationMs: BigInt(0),
  voicePlatformDurationMs: BigInt(0),
  llmUserTokens: BigInt(0),
  llmPlatformTokens: BigInt(0),
};

function toPositiveBigInt(value: number | bigint) {
  if (typeof value === "bigint") {
    return value > BigInt(0) ? value : BigInt(0);
  }

  if (!Number.isFinite(value) || value <= 0) {
    return BigInt(0);
  }

  return BigInt(Math.round(value));
}

function clampBigIntToNumber(value: bigint) {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maxSafe ? maxSafe : value);
}

function subtractFromLimit(limit: bigint | null, used: bigint) {
  if (limit == null) {
    return null;
  }

  return used >= limit ? BigInt(0) : limit - used;
}

function resolveVoiceCounterField(source: KeySource): UsageCounterField | null {
  if (source === "user") {
    return "voiceUserDurationMs";
  }
  if (source === "system") {
    return "voicePlatformDurationMs";
  }

  return null;
}

function resolveLlmCounterField(source: RuntimeSource): UsageCounterField | null {
  if (source === "user") {
    return "llmUserTokens";
  }
  if (source === "system") {
    return "llmPlatformTokens";
  }

  return null;
}

async function incrementUsageCounter(userId: string, field: UsageCounterField, amount: bigint) {
  if (amount <= BigInt(0)) {
    return;
  }

  await prisma.userUsageStats.upsert({
    where: { userId },
    create: {
      userId,
      [field]: amount,
    },
    update: {
      [field]: {
        increment: amount,
      },
    },
  });
}

export async function getUserUsageCounterSnapshot(userId: string): Promise<UserUsageCounterSnapshot> {
  const stats = await prisma.userUsageStats.findUnique({
    where: { userId },
    select: {
      voiceUserDurationMs: true,
      voicePlatformDurationMs: true,
      llmUserTokens: true,
      llmPlatformTokens: true,
    },
  });

  return stats ?? EMPTY_USAGE_COUNTER_SNAPSHOT;
}

export async function recordVoiceUsageForOwner({
  ownerUserId,
  source,
  durationMs,
}: {
  ownerUserId: string | null | undefined;
  source: KeySource;
  durationMs: number | bigint;
}) {
  if (!ownerUserId) {
    return;
  }

  const field = resolveVoiceCounterField(source);
  if (!field) {
    return;
  }

  await incrementUsageCounter(ownerUserId, field, toPositiveBigInt(durationMs));
}

export async function recordLlmUsageForOwner({
  ownerUserId,
  source,
  totalTokens,
}: {
  ownerUserId: string | null | undefined;
  source: RuntimeSource;
  totalTokens: number | bigint | null | undefined;
}) {
  if (!ownerUserId || totalTokens == null) {
    return;
  }

  const field = resolveLlmCounterField(source);
  if (!field) {
    return;
  }

  await incrementUsageCounter(ownerUserId, field, toPositiveBigInt(totalTokens));
}

export async function getUserUsageSummary(userId: string): Promise<UserUsageSummary> {
  const stats = await getUserUsageCounterSnapshot(userId);
  const platformVoiceLimitMinutes = getPlatformTranscriptionLimitMinutesPerUser();
  const platformVoiceLimitMs =
    platformVoiceLimitMinutes == null ? null : BigInt(platformVoiceLimitMinutes) * MS_PER_MINUTE;
  const platformVoiceRemainingMs = subtractFromLimit(platformVoiceLimitMs, stats.voicePlatformDurationMs);
  const platformLlmLimitTokens = getPlatformLlmLimitTokensPerUser();
  const platformLlmLimit =
    platformLlmLimitTokens == null ? null : BigInt(platformLlmLimitTokens);
  const platformLlmRemaining = subtractFromLimit(platformLlmLimit, stats.llmPlatformTokens);

  return {
    voice: {
      userSeconds: clampBigIntToNumber(stats.voiceUserDurationMs) / 1000,
      platformSeconds: clampBigIntToNumber(stats.voicePlatformDurationMs) / 1000,
      platformLimitSeconds:
        platformVoiceLimitMs == null ? null : clampBigIntToNumber(platformVoiceLimitMs / MS_PER_SECOND),
      platformRemainingSeconds:
        platformVoiceRemainingMs == null
          ? null
          : clampBigIntToNumber(platformVoiceRemainingMs / MS_PER_SECOND),
      platformExceeded:
        platformVoiceLimitMs != null && stats.voicePlatformDurationMs >= platformVoiceLimitMs,
    },
    llm: {
      userTokens: clampBigIntToNumber(stats.llmUserTokens),
      platformTokens: clampBigIntToNumber(stats.llmPlatformTokens),
      platformLimitTokens:
        platformLlmLimit == null ? null : clampBigIntToNumber(platformLlmLimit),
      platformRemainingTokens:
        platformLlmRemaining == null ? null : clampBigIntToNumber(platformLlmRemaining),
      platformExceeded:
        platformLlmLimit != null && stats.llmPlatformTokens >= platformLlmLimit,
    },
  };
}
