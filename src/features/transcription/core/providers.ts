import { TranscriptionProvider as PrismaTranscriptionProvider } from "@prisma/client";

export const TRANSCRIPTION_PROVIDER_NAMES = ["deepgram", "dashscope"] as const;

export type TranscriptionProviderName = (typeof TRANSCRIPTION_PROVIDER_NAMES)[number];

function normalizeCredentialValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function getSupportedTranscriptionProviders(): TranscriptionProviderName[] {
  return [...TRANSCRIPTION_PROVIDER_NAMES];
}

export function isTranscriptionProviderName(value: string | null | undefined): value is TranscriptionProviderName {
  return value === "deepgram" || value === "dashscope";
}

export function parseTranscriptionProviderName(value: string | null | undefined): TranscriptionProviderName | null {
  const normalized = value?.trim().toLowerCase();
  return isTranscriptionProviderName(normalized) ? normalized : null;
}

export function isValidTranscriptionApiKey(
  provider: TranscriptionProviderName,
  value: string | null | undefined,
) {
  const normalized = normalizeCredentialValue(value);
  if (!normalized) {
    return false;
  }

  if (provider === "dashscope") {
    return /^sk-[A-Za-z0-9._-]{8,}$/.test(normalized);
  }

  return true;
}

export function getTranscriptionApiKeyValidationError(
  provider: TranscriptionProviderName,
  value: string | null | undefined,
) {
  const normalized = normalizeCredentialValue(value);
  if (!normalized) {
    return "apiKey is required";
  }

  if (provider === "dashscope" && !isValidTranscriptionApiKey(provider, normalized)) {
    return "DashScope API key must start with sk-";
  }

  return null;
}

export function toPrismaTranscriptionProvider(
  provider: TranscriptionProviderName,
): PrismaTranscriptionProvider {
  switch (provider) {
    case "deepgram":
      return PrismaTranscriptionProvider.DEEPGRAM;
    case "dashscope":
      return PrismaTranscriptionProvider.DASHSCOPE;
  }
}

export function fromPrismaTranscriptionProvider(
  provider: PrismaTranscriptionProvider,
): TranscriptionProviderName {
  switch (provider) {
    case PrismaTranscriptionProvider.DEEPGRAM:
      return "deepgram";
    case PrismaTranscriptionProvider.DASHSCOPE:
      return "dashscope";
  }
}
