import type { RuntimeSource } from "@/lib/llm-provider-keys";
import type { KeySource } from "@/lib/provider-sources";
import { prisma } from "@/lib/prisma";

export type UserUsageSummary = {
  voice: {
    userSeconds: number;
    platformSeconds: number;
  };
  llm: {
    userTokens: number;
    platformTokens: number;
  };
};

type UsageCounterField =
  | "voiceUserDurationMs"
  | "voicePlatformDurationMs"
  | "llmUserTokens"
  | "llmPlatformTokens";

const EMPTY_USAGE_SUMMARY: UserUsageSummary = {
  voice: {
    userSeconds: 0,
    platformSeconds: 0,
  },
  llm: {
    userTokens: 0,
    platformTokens: 0,
  },
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
  const stats = await prisma.userUsageStats.findUnique({
    where: { userId },
    select: {
      voiceUserDurationMs: true,
      voicePlatformDurationMs: true,
      llmUserTokens: true,
      llmPlatformTokens: true,
    },
  });

  if (!stats) {
    return EMPTY_USAGE_SUMMARY;
  }

  return {
    voice: {
      userSeconds: clampBigIntToNumber(stats.voiceUserDurationMs) / 1000,
      platformSeconds: clampBigIntToNumber(stats.voicePlatformDurationMs) / 1000,
    },
    llm: {
      userTokens: clampBigIntToNumber(stats.llmUserTokens),
      platformTokens: clampBigIntToNumber(stats.llmPlatformTokens),
    },
  };
}
