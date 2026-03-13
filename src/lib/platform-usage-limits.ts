import {
  getPlatformLlmLimitTokensPerUser,
  getPlatformTranscriptionLimitMinutesPerUser,
} from "@/lib/env";
import { getUserUsageCounterSnapshot } from "@/lib/usage-stats";

const MS_PER_MINUTE = BigInt(60_000);

export type PlatformUsageGate = {
  limit: bigint | null;
  used: bigint;
  remaining: bigint | null;
  exceeded: boolean;
};

function buildUsageGate(used: bigint, limit: bigint | null): PlatformUsageGate {
  if (limit == null) {
    return {
      limit: null,
      used,
      remaining: null,
      exceeded: false,
    };
  }

  return {
    limit,
    used,
    remaining: used >= limit ? BigInt(0) : limit - used,
    exceeded: used >= limit,
  };
}

export async function getPlatformTranscriptionUsageGate(userId: string): Promise<PlatformUsageGate> {
  const usage = await getUserUsageCounterSnapshot(userId);
  const limitMinutes = getPlatformTranscriptionLimitMinutesPerUser();

  return buildUsageGate(
    usage.voicePlatformDurationMs,
    limitMinutes == null ? null : BigInt(limitMinutes) * MS_PER_MINUTE,
  );
}

export async function getPlatformLlmUsageGate(userId: string): Promise<PlatformUsageGate> {
  const usage = await getUserUsageCounterSnapshot(userId);
  const limitTokens = getPlatformLlmLimitTokensPerUser();

  return buildUsageGate(
    usage.llmPlatformTokens,
    limitTokens == null ? null : BigInt(limitTokens),
  );
}

export function getPlatformTranscriptionQuotaExceededMessage() {
  const limitMinutes = getPlatformTranscriptionLimitMinutesPerUser();
  if (limitMinutes == null) {
    return "Platform transcription quota exceeded";
  }

  return `Platform transcription quota exceeded (${limitMinutes} minutes per user)`;
}

export function getPlatformLlmQuotaExceededMessage() {
  const limitTokens = getPlatformLlmLimitTokensPerUser();
  if (limitTokens == null) {
    return "Platform LLM quota exceeded";
  }

  return `Platform LLM quota exceeded (${limitTokens} tokens per user)`;
}
