import type { UserProviderKeysMode } from "@/lib/env";
import { toDateLocale, type UiLanguage } from "@/lib/ui-language";

export type DashboardTranslate = (zh: string, en: string) => string;

export type DashboardAuthMode = "login" | "register" | null;
export type RoomAction = "create" | "join";

export type RoomSummary = {
  roomId: string;
  roomName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  participantCount: number;
  messageCount: number;
  joinedAt?: string;
};

export type UserInfo = {
  id: string;
  username: string;
};

export type LivekitStatus = {
  configured: boolean;
  livekitUrlMask: string | null;
  livekitApiKeyMask: string | null;
  livekitApiSecretMask: string | null;
};

export type TranscriptionProviderName = "deepgram" | "dashscope";

export type TranscriptionSettingsStatus = {
  defaultProvider: TranscriptionProviderName | null;
  providers: Array<{
    provider: TranscriptionProviderName;
    configured: boolean;
    credentialMask: string | null;
  }>;
};

export type LlmKeyStatus = {
  configured: boolean;
  baseUrlMask: string | null;
  apiKeyMask: string | null;
  model: string | null;
};

export type UsageSummary = {
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

export type LivekitFormState = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

export type TranscriptionFormState = Record<TranscriptionProviderName, string>;

export type LlmFormState = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AuthFormState = {
  username: string;
  password: string;
};

export type DashboardPageClientProps = {
  initialUser: UserInfo | null;
  initialCreatedRooms: RoomSummary[];
  initialJoinedRooms: RoomSummary[];
  initialLivekitStatus: LivekitStatus | null;
  initialTranscriptionStatus: TranscriptionSettingsStatus | null;
  initialLlmKeyStatus: LlmKeyStatus | null;
  initialUsageSummary: UsageSummary | null;
  initialUserProviderKeysMode: UserProviderKeysMode;
  initialAuthMode: DashboardAuthMode;
  initialNextPath: string | null;
};

export type AuthResponse = {
  user?: UserInfo;
  error?: string;
};

export type DashboardResponse = {
  createdRooms: RoomSummary[];
  joinedRooms: RoomSummary[];
  usage: UsageSummary;
  error?: string;
};

export type StatusResponse<T> = {
  status: T;
  error?: string;
};

export const PROVIDERS: TranscriptionProviderName[] = ["deepgram", "dashscope"];
export const DASHSCOPE_DEFAULT_MODEL = "qwen3-asr-flash-realtime";

export const MANUAL_INPUT_PROPS = {
  autoComplete: "off",
  autoCapitalize: "none" as const,
  spellCheck: false,
};

export const MANUAL_SECRET_INPUT_PROPS = {
  autoComplete: "new-password",
  autoCapitalize: "none" as const,
  spellCheck: false,
};

export function emptyProviderForm(): TranscriptionFormState {
  return { deepgram: "", dashscope: "" };
}

export function normalizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/")) {
    return null;
  }
  return value;
}

export function isBlank(value: string) {
  return value.trim().length === 0;
}

export function formatDate(value: string | null, language: UiLanguage) {
  if (!value) {
    return language === "zh" ? "无" : "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(toDateLocale(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatSeconds(value: number, language: UiLanguage) {
  const formatter = new Intl.NumberFormat(toDateLocale(language), {
    minimumFractionDigits: value > 0 && value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  });
  return `${formatter.format(value)} ${language === "zh" ? "秒" : "s"}`;
}

export function formatTokens(value: number, language: UiLanguage) {
  const formatter = new Intl.NumberFormat(toDateLocale(language));
  return `${formatter.format(value)} tokens`;
}

export function formatVoiceUsage(value: number, language: UiLanguage) {
  if (Math.abs(value) < 60) {
    return formatSeconds(value, language);
  }

  const formatter = new Intl.NumberFormat(toDateLocale(language), {
    minimumFractionDigits: value > 0 && value < 600 ? 1 : 0,
    maximumFractionDigits: 1,
  });

  return `${formatter.format(value / 60)} min`;
}

export function roomStatusLabel(status: string, language: UiLanguage) {
  if (status === "ENDED") {
    return language === "zh" ? "已结束" : "Ended";
  }
  return language === "zh" ? "进行中" : "Active";
}

export function providerLabel(provider: TranscriptionProviderName, language: UiLanguage) {
  if (provider === "dashscope") {
    return language === "zh" ? "阿里千问 DashScope" : "DashScope Qwen";
  }
  return "Deepgram";
}

export function configuredLabel(configured: boolean, language: UiLanguage) {
  if (configured) {
    return language === "zh" ? "已配置" : "Configured";
  }
  return language === "zh" ? "未配置" : "Not configured";
}
