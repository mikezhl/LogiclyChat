"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import type { UserProviderKeysMode } from "@/lib/env";
import { getRoomDisplayName } from "@/lib/room-name";
import { toDateLocale, type UiLanguage } from "@/lib/ui-language";
import { useUiLanguage } from "@/lib/use-ui-language";

type RoomSummary = {
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

type UserInfo = {
  id: string;
  username: string;
};

type LivekitStatus = {
  configured: boolean;
  livekitUrlMask: string | null;
  livekitApiKeyMask: string | null;
  livekitApiSecretMask: string | null;
};

type TranscriptionProviderName = "deepgram" | "dashscope";

type TranscriptionSettingsStatus = {
  defaultProvider: TranscriptionProviderName | null;
  providers: Array<{
    provider: TranscriptionProviderName;
    configured: boolean;
    credentialMask: string | null;
  }>;
};

type LlmKeyStatus = {
  configured: boolean;
  baseUrlMask: string | null;
  apiKeyMask: string | null;
  model: string | null;
};

type UsageSummary = {
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

type DashboardPageClientProps = {
  initialUser: UserInfo | null;
  initialCreatedRooms: RoomSummary[];
  initialJoinedRooms: RoomSummary[];
  initialLivekitStatus: LivekitStatus | null;
  initialTranscriptionStatus: TranscriptionSettingsStatus | null;
  initialLlmKeyStatus: LlmKeyStatus | null;
  initialUsageSummary: UsageSummary | null;
  initialUserProviderKeysMode: UserProviderKeysMode;
  initialAuthMode: "login" | "register" | null;
  initialNextPath: string | null;
};

type AuthResponse = {
  user?: UserInfo;
  error?: string;
};

type DashboardResponse = {
  createdRooms: RoomSummary[];
  joinedRooms: RoomSummary[];
  usage: UsageSummary;
  error?: string;
};

type StatusResponse<T> = {
  status: T;
  error?: string;
};

const PROVIDERS: TranscriptionProviderName[] = ["deepgram", "dashscope"];
const DASHSCOPE_DEFAULT_MODEL = "qwen3-asr-flash-realtime";

function emptyProviderForm(): Record<TranscriptionProviderName, string> {
  return { deepgram: "", dashscope: "" };
}

function normalizeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/")) {
    return null;
  }
  return value;
}

function isBlank(value: string) {
  return value.trim().length === 0;
}

function formatDate(value: string | null, language: UiLanguage) {
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

function formatSeconds(value: number, language: UiLanguage) {
  const formatter = new Intl.NumberFormat(toDateLocale(language), {
    minimumFractionDigits: value > 0 && value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  });
  return `${formatter.format(value)} ${language === "zh" ? "秒" : "s"}`;
}

function formatTokens(value: number, language: UiLanguage) {
  const formatter = new Intl.NumberFormat(toDateLocale(language));
  return `${formatter.format(value)} tokens`;
}

function formatVoiceUsage(value: number, language: UiLanguage) {
  if (Math.abs(value) < 60) {
    return formatSeconds(value, language);
  }

  const formatter = new Intl.NumberFormat(toDateLocale(language), {
    minimumFractionDigits: value > 0 && value < 600 ? 1 : 0,
    maximumFractionDigits: 1,
  });

  return `${formatter.format(value / 60)} min`;
}

function roomStatusLabel(status: string, language: UiLanguage) {
  if (status === "ENDED") {
    return language === "zh" ? "已结束" : "Ended";
  }
  return language === "zh" ? "进行中" : "Active";
}

function providerLabel(provider: TranscriptionProviderName, language: UiLanguage) {
  if (provider === "dashscope") {
    return language === "zh" ? "阿里千问 DashScope" : "DashScope Qwen";
  }
  return "Deepgram";
}

function configuredLabel(configured: boolean, language: UiLanguage) {
  if (configured) {
    return language === "zh" ? "已配置" : "Configured";
  }
  return language === "zh" ? "未配置" : "Not configured";
}

export default function DashboardPageClient({
  initialUser,
  initialCreatedRooms,
  initialJoinedRooms,
  initialLivekitStatus,
  initialTranscriptionStatus,
  initialLlmKeyStatus,
  initialUsageSummary,
  initialUserProviderKeysMode,
  initialAuthMode,
  initialNextPath,
}: DashboardPageClientProps) {
  const router = useRouter();
  const { language, setLanguage } = useUiLanguage();
  const isZh = language === "zh";
  const t = (zh: string, en: string) => (isZh ? zh : en);

  const [user, setUser] = useState<UserInfo | null>(initialUser);
  const [createdRooms, setCreatedRooms] = useState(initialCreatedRooms);
  const [joinedRooms, setJoinedRooms] = useState(initialJoinedRooms);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(initialUsageSummary);
  const [roomIdToJoin, setRoomIdToJoin] = useState("");
  const [roomActionError, setRoomActionError] = useState("");
  const [roomActionLoading, setRoomActionLoading] = useState<"create" | "join" | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const [livekitStatus, setLivekitStatus] = useState<LivekitStatus | null>(initialLivekitStatus);
  const [livekitForm, setLivekitForm] = useState({
    livekitUrl: "",
    livekitApiKey: "",
    livekitApiSecret: "",
  });
  const [livekitLoading, setLivekitLoading] = useState(false);
  const [livekitError, setLivekitError] = useState("");

  const [transcriptionStatus, setTranscriptionStatus] =
    useState<TranscriptionSettingsStatus | null>(initialTranscriptionStatus);
  const [transcriptionForm, setTranscriptionForm] = useState(emptyProviderForm());
  const [transcriptionLoading, setTranscriptionLoading] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState("");

  const [llmKeyStatus, setLlmKeyStatus] = useState<LlmKeyStatus | null>(initialLlmKeyStatus);
  const [llmForm, setLlmForm] = useState({ baseUrl: "", apiKey: "", model: "" });
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState("");

  const [authMode, setAuthMode] = useState<"login" | "register" | null>(initialAuthMode);
  const [authNextPath, setAuthNextPath] = useState<string | null>(normalizeNextPath(initialNextPath));
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pendingRoomAction, setPendingRoomAction] = useState<"create" | "join" | null>(null);

  const isAuthenticated = Boolean(user);
  const showUserProviderSettings = initialUserProviderKeysMode !== "false";
  const hasHistory = createdRooms.length > 0 || joinedRooms.length > 0;
  const authTitle = authMode === "register" ? t("注册", "Sign Up") : t("登录", "Sign In");
  const heroSubtitle = isAuthenticated
    ? t(
        `你好，${user?.username}。可以直接创建或加入房间。`,
        `Hi, ${user?.username}. You can create or join a room right away.`,
      )
    : t(
        "一个实时的 AI 辩论/吵架辅助 + 分析 + 总结平台",
        "A real-time AI debate and argument copilot for assist, analysis, and summaries.",
      );
  const providerMap = new Map((transcriptionStatus?.providers ?? []).map((item) => [item.provider, item]));
  const manualInputProps = {
    autoComplete: "off",
    autoCapitalize: "none" as const,
    spellCheck: false,
  };
  const manualSecretInputProps = {
    autoComplete: "new-password",
    autoCapitalize: "none" as const,
    spellCheck: false,
  };

  function toggleLanguage() {
    setLanguage(isZh ? "en" : "zh");
  }

  function openAuthModal(mode: "login" | "register", nextPath?: string | null) {
    setAuthMode(mode);
    setAuthError("");
    if (typeof nextPath !== "undefined") {
      setAuthNextPath(normalizeNextPath(nextPath));
    }
  }

  function clearDataAfterLogout() {
    setUser(null);
    setCreatedRooms([]);
    setJoinedRooms([]);
    setUsageSummary(null);
    setLivekitStatus(null);
    setTranscriptionStatus(null);
    setLlmKeyStatus(null);
    setLivekitForm({ livekitUrl: "", livekitApiKey: "", livekitApiSecret: "" });
    setTranscriptionForm(emptyProviderForm());
    setLlmForm({ baseUrl: "", apiKey: "", model: "" });
    setLivekitError("");
    setTranscriptionError("");
    setLlmError("");
  }

  async function readJson<T>(response: Response, fallback: string): Promise<T> {
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      if (response.status === 401) {
        clearDataAfterLogout();
        openAuthModal("login");
      }
      throw new Error(payload.error ?? fallback);
    }
    return payload;
  }

  async function getProtected<T>(url: string, fallback: string) {
    return readJson<T>(await fetch(url, { cache: "no-store" }), fallback);
  }

  async function postProtected<T>(url: string, body: unknown, fallback: string) {
    return readJson<T>(
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      fallback,
    );
  }

  async function loadAuthenticatedData() {
    const [dashboard, livekit, transcription, llm] = await Promise.all([
      getProtected<DashboardResponse>("/api/rooms/dashboard", t("获取历史房间失败", "Failed to load room history")),
      getProtected<StatusResponse<LivekitStatus>>("/api/account/livekit", t("读取 LiveKit 状态失败", "Failed to read LiveKit status")),
      getProtected<StatusResponse<TranscriptionSettingsStatus>>("/api/account/transcription", t("读取转录配置失败", "Failed to read transcription settings")),
      getProtected<StatusResponse<LlmKeyStatus>>("/api/account/llm", t("读取 LLM 状态失败", "Failed to read LLM status")),
    ]);
    setCreatedRooms(dashboard.createdRooms);
    setJoinedRooms(dashboard.joinedRooms);
    setUsageSummary(dashboard.usage);
    setLivekitStatus(livekit.status);
    setTranscriptionStatus(transcription.status);
    setLlmKeyStatus(llm.status);
  }

  async function requireAuthForRoomAction(action: "create" | "join") {
    if (isAuthenticated) {
      return true;
    }
    setPendingRoomAction(action);
    setRoomActionError(t("请先登录后再操作。", "Please sign in first."));
    openAuthModal("login");
    return false;
  }

  async function bootstrapRoom(action: "create" | "join") {
    if (action === "join" && !roomIdToJoin.trim()) {
      setRoomActionError(t("请输入房间号。", "Please enter a room ID."));
      return;
    }

    setRoomActionLoading(action);
    setRoomActionError("");

    try {
      const payload = await postProtected<{ roomId?: string }>(
        "/api/rooms/bootstrap",
        action === "create" ? { action } : { action, roomId: roomIdToJoin.trim() },
        t("房间操作失败", "Room action failed"),
      );
      if (!payload.roomId) {
        throw new Error(t("房间操作失败", "Room action failed"));
      }
      setPendingRoomAction(null);
      router.push(`/${encodeURIComponent(payload.roomId)}`);
    } catch (error) {
      setRoomActionError(error instanceof Error ? error.message : t("房间操作失败", "Room action failed"));
    } finally {
      setRoomActionLoading(null);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authMode) {
      return;
    }

    setAuthLoading(true);
    setAuthError("");

    try {
      const payload = await postProtected<AuthResponse>(
        authMode === "login" ? "/api/auth/login" : "/api/auth/register",
        authForm,
        `${authTitle}${t("失败", " failed")}`,
      );
      if (!payload.user) {
        throw new Error(`${authTitle}${t("失败", " failed")}`);
      }
      setUser(payload.user);
      setAuthMode(null);
      setAuthForm({ username: "", password: "" });
      await loadAuthenticatedData();

      if (authNextPath) {
        const target = authNextPath;
        setAuthNextPath(null);
        router.replace(target);
        return;
      }

      if (pendingRoomAction) {
        const action = pendingRoomAction;
        setPendingRoomAction(null);
        await bootstrapRoom(action);
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : `${authTitle}${t("失败", " failed")}`);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreateRoom() {
    const canContinue = await requireAuthForRoomAction("create");
    if (canContinue) {
      await bootstrapRoom("create");
    }
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const canContinue = await requireAuthForRoomAction("join");
    if (canContinue) {
      await bootstrapRoom("join");
    }
  }

  async function refreshDashboard() {
    if (!isAuthenticated) {
      return;
    }

    setDashboardLoading(true);
    setRoomActionError("");

    try {
      const payload = await getProtected<DashboardResponse>(
        "/api/rooms/dashboard",
        t("获取历史房间失败", "Failed to load room history"),
      );
      setCreatedRooms(payload.createdRooms);
      setJoinedRooms(payload.joinedRooms);
      setUsageSummary(payload.usage);
    } catch (error) {
      setRoomActionError(error instanceof Error ? error.message : t("获取历史房间失败", "Failed to load room history"));
    } finally {
      setDashboardLoading(false);
    }
  }

  async function refreshLivekitStatus() {
    const payload = await getProtected<StatusResponse<LivekitStatus>>(
      "/api/account/livekit",
      t("读取 LiveKit 状态失败", "Failed to read LiveKit status"),
    );
    setLivekitStatus(payload.status);
  }

  async function refreshTranscriptionStatus() {
    const payload = await getProtected<StatusResponse<TranscriptionSettingsStatus>>(
      "/api/account/transcription",
      t("读取转录配置失败", "Failed to read transcription settings"),
    );
    setTranscriptionStatus(payload.status);
  }

  async function refreshLlmStatus() {
    const payload = await getProtected<StatusResponse<LlmKeyStatus>>(
      "/api/account/llm",
      t("读取 LLM 状态失败", "Failed to read LLM status"),
    );
    setLlmKeyStatus(payload.status);
  }

  async function saveLivekit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.values(livekitForm).some(isBlank)) {
      setLivekitError(t("保存时必须同时填写 LiveKit URL、LiveKit API Key 和 LiveKit API Secret。", "LiveKit URL, LiveKit API key, and LiveKit API secret are required."));
      return;
    }
    setLivekitLoading(true);
    setLivekitError("");
    try {
      const payload = await postProtected<StatusResponse<LivekitStatus>>("/api/account/livekit", livekitForm, t("保存 LiveKit 配置失败", "Failed to save LiveKit settings"));
      setLivekitStatus(payload.status);
      setLivekitForm({ livekitUrl: "", livekitApiKey: "", livekitApiSecret: "" });
    } catch (error) {
      setLivekitError(error instanceof Error ? error.message : t("保存 LiveKit 配置失败", "Failed to save LiveKit settings"));
    } finally {
      setLivekitLoading(false);
    }
  }

  async function clearLivekit() {
    setLivekitLoading(true);
    setLivekitError("");
    try {
      const payload = await postProtected<StatusResponse<LivekitStatus>>("/api/account/livekit", { clear: true }, t("清空 LiveKit 配置失败", "Failed to clear LiveKit settings"));
      setLivekitStatus(payload.status);
      setLivekitForm({ livekitUrl: "", livekitApiKey: "", livekitApiSecret: "" });
    } catch (error) {
      setLivekitError(error instanceof Error ? error.message : t("清空 LiveKit 配置失败", "Failed to clear LiveKit settings"));
    } finally {
      setLivekitLoading(false);
    }
  }

  async function saveTranscription(event: FormEvent<HTMLFormElement>, provider: TranscriptionProviderName) {
    event.preventDefault();
    if (isBlank(transcriptionForm[provider])) {
      setTranscriptionError(t("API Key 为必填项。", "API key is required."));
      return;
    }
    setTranscriptionLoading(`save:${provider}`);
    setTranscriptionError("");
    try {
      const payload = await postProtected<StatusResponse<TranscriptionSettingsStatus>>("/api/account/transcription", { action: "save", provider, apiKey: transcriptionForm[provider].trim() }, t("保存转录配置失败", "Failed to save transcription settings"));
      setTranscriptionStatus(payload.status);
      setTranscriptionForm((current) => ({ ...current, [provider]: "" }));
    } catch (error) {
      setTranscriptionError(error instanceof Error ? error.message : t("保存转录配置失败", "Failed to save transcription settings"));
    } finally {
      setTranscriptionLoading(null);
    }
  }

  async function clearTranscription(provider: TranscriptionProviderName) {
    setTranscriptionLoading(`clear:${provider}`);
    setTranscriptionError("");
    try {
      const payload = await postProtected<StatusResponse<TranscriptionSettingsStatus>>("/api/account/transcription", { action: "clear", provider }, t("清空转录配置失败", "Failed to clear transcription settings"));
      setTranscriptionStatus(payload.status);
      setTranscriptionForm((current) => ({ ...current, [provider]: "" }));
    } catch (error) {
      setTranscriptionError(error instanceof Error ? error.message : t("清空转录配置失败", "Failed to clear transcription settings"));
    } finally {
      setTranscriptionLoading(null);
    }
  }

  async function setDefaultProvider(provider: TranscriptionProviderName | null) {
    setTranscriptionLoading(`default:${provider ?? "none"}`);
    setTranscriptionError("");
    try {
      const payload = await postProtected<StatusResponse<TranscriptionSettingsStatus>>("/api/account/transcription", { action: "set-default", provider }, t("更新默认转录工具失败", "Failed to update default transcription provider"));
      setTranscriptionStatus(payload.status);
    } catch (error) {
      setTranscriptionError(error instanceof Error ? error.message : t("更新默认转录工具失败", "Failed to update default transcription provider"));
    } finally {
      setTranscriptionLoading(null);
    }
  }

  async function saveLlm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.values(llmForm).some(isBlank)) {
      setLlmError(t("保存时必须同时填写 LLM URL、LLM API Key 和 LLM Model。", "LLM URL, LLM API key, and LLM model are required."));
      return;
    }
    setLlmLoading(true);
    setLlmError("");
    try {
      const payload = await postProtected<StatusResponse<LlmKeyStatus>>("/api/account/llm", llmForm, t("保存 LLM 配置失败", "Failed to save LLM settings"));
      setLlmKeyStatus(payload.status);
      setLlmForm({ baseUrl: "", apiKey: "", model: "" });
    } catch (error) {
      setLlmError(error instanceof Error ? error.message : t("保存 LLM 配置失败", "Failed to save LLM settings"));
    } finally {
      setLlmLoading(false);
    }
  }

  async function clearLlm() {
    setLlmLoading(true);
    setLlmError("");
    try {
      const payload = await postProtected<StatusResponse<LlmKeyStatus>>("/api/account/llm", { clear: true }, t("清空 LLM 配置失败", "Failed to clear LLM settings"));
      setLlmKeyStatus(payload.status);
      setLlmForm({ baseUrl: "", apiKey: "", model: "" });
    } catch (error) {
      setLlmError(error instanceof Error ? error.message : t("清空 LLM 配置失败", "Failed to clear LLM settings"));
    } finally {
      setLlmLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearDataAfterLogout();
  }

  return (
    <>
      <main className="dashboard-page minimal-page">
        <section className="minimal-shell">
          <header className="minimal-header">
            <div>
              <h1>{t("急了么？", "Logicly Chat")}</h1>
              <p className="subtitle">{heroSubtitle}</p>
            </div>
            <div className="header-actions">
              <a
                href="https://github.com/mikezhl/LogiclyChat"
                target="_blank"
                rel="noopener noreferrer"
                className="github-icon-link"
                aria-label="GitHub"
                title="GitHub"
              >
                <svg className="github-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#202123"
                    d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"
                  />
                </svg>
              </a>
              <button
                type="button"
                className="lang-toggle-btn"
                aria-label={t("切换到英文", "Switch to Chinese")}
                onClick={toggleLanguage}
              >
                {isZh ? "EN" : "中"}
              </button>
              {isAuthenticated ? (
                <>
                  <span className="user-chip">
                    <span className="desktop-only">{user?.username}</span>
                    <span className="mobile-only">{user?.username?.substring(0, 8)}{user?.username && user.username.length > 8 ? '...' : ''}</span>
                  </span>
                  <button type="button" className="ghost-btn" onClick={() => void handleLogout()}>
                    <span className="desktop-only">{t("退出登录", "Sign Out")}</span>
                    <span className="mobile-only">{t("退出", "Out")}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      setPendingRoomAction(null);
                      openAuthModal("login");
                    }}
                  >
                    {t("登录", "Sign In")}
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      setPendingRoomAction(null);
                      openAuthModal("register");
                    }}
                  >
                    {t("注册", "Sign Up")}
                  </button>
                </>
              )}
            </div>
          </header>

          <section className="minimal-main-card">
            <div className="room-quick-actions">
              <button
                type="button"
                className="primary-btn large-btn"
                disabled={roomActionLoading !== null}
                onClick={() => void handleCreateRoom()}
              >
                {roomActionLoading === "create"
                  ? t("创建中...", "Creating...")
                  : t("创建房间", "Create Room")}
              </button>
              <form className="join-room-form" onSubmit={handleJoinRoom}>
                <input
                  value={roomIdToJoin}
                  onChange={(event) => setRoomIdToJoin(event.target.value)}
                  placeholder={t("输入已有房间号", "Enter an existing room ID")}
                />
                <button type="submit" className="primary-btn large-btn" disabled={roomActionLoading !== null}>
                  {roomActionLoading === "join"
                    ? t("加入中...", "Joining...")
                    : t("加入", "Join")}
                </button>
              </form>
            </div>
            {roomActionError ? <p className="form-error">{roomActionError}</p> : null}
          </section>

          <section className="minimal-details-wrap">
            <details className="minimal-details">
              <summary>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>{t("查看历史房间", "Room History")}</span>
                  {isAuthenticated ? (
                    <button
                      type="button"
                      title={t("刷新历史", "Refresh history")}
                      style={{
                        padding: "4px",
                        background: "transparent",
                        border: "none",
                        color: "var(--muted)",
                        cursor: dashboardLoading ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: dashboardLoading ? 0.5 : 1,
                        transition: "opacity 0.2s, color 0.2s",
                        borderRadius: "4px",
                      }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.color = "var(--foreground)";
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.color = "var(--muted)";
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        if (!dashboardLoading) {
                          void refreshDashboard();
                        }
                      }}
                      disabled={dashboardLoading}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                        <path d="M21 3v5h-5" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </summary>
              {!isAuthenticated ? (
                <div className="details-content">
                  <p className="panel-tip">
                    {t("登录后可查看你创建和参与的房间记录。", "Sign in to view rooms you created or joined.")}
                  </p>
                </div>
              ) : (
                <div className="details-content room-history-details">
                  {!hasHistory ? (
                    <p className="panel-tip">{t("暂无历史房间。", "No room history yet.")}</p>
                  ) : (
                    <>
                      <div className="history-group">
                        <h3>{t("我创建的房间", "Rooms I Created")}</h3>
                        {createdRooms.length === 0 ? (
                          <p className="panel-tip">{t("暂无记录。", "No records.")}</p>
                        ) : (
                          <ul className="room-list">
                            {createdRooms.map((room) => {
                              const roomDisplayName = getRoomDisplayName(room.roomName, room.roomId);
                              const showRoomCode = Boolean(room.roomName);

                              return (
                                <li key={`created-${room.roomId}`}>
                                  <Link
                                    className="room-list-item"
                                    href={`/${encodeURIComponent(room.roomId)}`}
                                    aria-label={`${t("进入房间", "Open room")} ${roomDisplayName}${showRoomCode ? ` (${room.roomId})` : ""}`}
                                  >
                                    <div className="room-list-item-copy">
                                      <strong>{roomDisplayName}</strong>
                                      {showRoomCode ? (
                                        <p className="room-list-code">
                                          {t("房间代码", "Room code")}: {room.roomId}
                                        </p>
                                      ) : null}
                                      <p>
                                        {t("成员", "Members")}: {room.participantCount} |{" "}
                                        {t("消息", "Messages")}: {room.messageCount}
                                      </p>
                                      <p>{t("创建", "Created")}: {formatDate(room.createdAt, language)}</p>
                                    </div>
                                    <span className="room-list-status" data-status={room.status}>
                                      {roomStatusLabel(room.status, language)}
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      <div className="history-group">
                        <h3>{t("我参与的房间", "Rooms I Joined")}</h3>
                        {joinedRooms.length === 0 ? (
                          <p className="panel-tip">{t("暂无记录。", "No records.")}</p>
                        ) : (
                          <ul className="room-list">
                            {joinedRooms.map((room) => {
                              const roomDisplayName = getRoomDisplayName(room.roomName, room.roomId);
                              const showRoomCode = Boolean(room.roomName);

                              return (
                                <li key={`joined-${room.roomId}`}>
                                  <Link
                                    className="room-list-item"
                                    href={`/${encodeURIComponent(room.roomId)}`}
                                    aria-label={`${t("进入房间", "Open room")} ${roomDisplayName}${showRoomCode ? ` (${room.roomId})` : ""}`}
                                  >
                                    <div className="room-list-item-copy">
                                      <strong>{roomDisplayName}</strong>
                                      {showRoomCode ? (
                                        <p className="room-list-code">
                                          {t("房间代码", "Room code")}: {room.roomId}
                                        </p>
                                      ) : null}
                                      <p>
                                        {t("成员", "Members")}: {room.participantCount} |{" "}
                                        {t("消息", "Messages")}: {room.messageCount}
                                      </p>
                                      <p>
                                        {t("最近加入", "Last joined")}:{" "}
                                        {formatDate(room.joinedAt ?? room.updatedAt, language)}
                                      </p>
                                    </div>
                                    <span className="room-list-status" data-status={room.status}>
                                      {roomStatusLabel(room.status, language)}
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </details>

            <details className="minimal-details">
              <summary>{t("使用量统计", "Usage Stats")}</summary>
              {!isAuthenticated ? (
                <div className="details-content">
                  <p className="panel-tip">
                    {t("登录后可查看累计消耗统计。", "Sign in to view your accumulated usage.")}
                  </p>
                </div>
              ) : (
                <div className="details-content">
                  <p className="panel-tip">
                    {t(
                      "仅统计房主名下房间产生的消耗。房间参与者不会累计自己的 Key 或平台用量。",
                      "Only usage generated under rooms you own is counted. Participants do not accumulate their own or platform usage.",
                    )}
                  </p>
                  <div className="usage-summary-grid">
                    <section className="usage-summary-column" style={{ minWidth: 0 }}>
                      <h4>{t("语音", "Voice")}</h4>
                      <div className="key-status-grid">
                        <span>
                          {t("自有 Key", "Own Key")}:{" "}
                          {formatSeconds(usageSummary?.voice.userSeconds ?? 0, language)}
                        </span>
                        <span>
                          {t("平台 Key", "Platform Key")}:{" "}
                          {formatVoiceUsage(usageSummary?.voice.platformSeconds ?? 0, language)}
                          {" / "}
                          {usageSummary?.voice.platformLimitSeconds == null
                            ? t("无限制", "No limit")
                            : formatVoiceUsage(usageSummary.voice.platformLimitSeconds, language)}
                        </span>
                        <span>
                          {t("剩余", "Remaining")}:{" "}
                          {usageSummary?.voice.platformRemainingSeconds == null
                            ? t("无限制", "No limit")
                            : formatVoiceUsage(usageSummary.voice.platformRemainingSeconds, language)}
                        </span>
                        <span>
                          {t("配额状态", "Quota Status")}:{" "}
                          {usageSummary?.voice.platformExceeded
                            ? t("已超限", "Exceeded")
                            : t("可用", "Available")}
                        </span>
                      </div>
                    </section>
                    <section className="usage-summary-column" style={{ minWidth: 0 }}>
                      <h4>{t("LLM", "LLM")}</h4>
                      <div className="key-status-grid">
                        <span>
                          {t("自有 Key", "Own Key")}:{" "}
                          {formatTokens(usageSummary?.llm.userTokens ?? 0, language)}
                        </span>
                        <span>
                          {t("平台 Key", "Platform Key")}:{" "}
                          {formatTokens(usageSummary?.llm.platformTokens ?? 0, language)}
                          {" / "}
                          {usageSummary?.llm.platformLimitTokens == null
                            ? t("无限制", "No limit")
                            : formatTokens(usageSummary.llm.platformLimitTokens, language)}
                        </span>
                        <span>
                          {t("剩余", "Remaining")}:{" "}
                          {usageSummary?.llm.platformRemainingTokens == null
                            ? t("无限制", "No limit")
                            : formatTokens(usageSummary.llm.platformRemainingTokens, language)}
                        </span>
                        <span>
                          {t("配额状态", "Quota Status")}:{" "}
                          {usageSummary?.llm.platformExceeded
                            ? t("已超限", "Exceeded")
                            : t("可用", "Available")}
                        </span>
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </details>

            {showUserProviderSettings ? (
              <>
            <details className="minimal-details">
              <summary>{t("配置 LiveKit 通话", "Configure LiveKit Transport")}</summary>
              {!isAuthenticated ? (
                <div className="details-content">
                  <p className="panel-tip">
                    {t(
                      "登录后可单独保存你自己的 LiveKit 通话配置。",
                      "Sign in to store your own LiveKit transport settings separately.",
                    )}
                  </p>
                </div>
              ) : (
                <div className="details-content">
                  <p className="panel-tip">
                    {t("当前状态", "Current status")}:{" "}
                    {configuredLabel(Boolean(livekitStatus?.configured), language)}。
                    {t(
                      "这一组配置只负责 LiveKit 通话接入，与实时转录平台分开保存。启用用户 Key 模式时，房主必须同时具备完整的 LiveKit 与默认转录工具配置，系统不会混用平台和个人 Key。",
                      "These credentials only cover LiveKit transport and are stored separately from realtime transcription providers. In user-key modes, the room owner must have both a complete LiveKit bundle and a configured default transcription provider. Platform and personal keys are never mixed.",
                    )}
                  </p>
                  <div className="key-status-grid">
                    <span>
                      LiveKit URL: {livekitStatus?.livekitUrlMask ?? t("未配置", "Not configured")}
                    </span>
                    <span>
                      LiveKit API Key: {livekitStatus?.livekitApiKeyMask ?? t("未配置", "Not configured")}
                    </span>
                    <span>
                      LiveKit API Secret:{" "}
                      {livekitStatus?.livekitApiSecretMask ?? t("未配置", "Not configured")}
                    </span>
                  </div>
                  <form className="key-form" onSubmit={saveLivekit} autoComplete="off">
                    <input
                      {...manualInputProps}
                      type="url"
                      inputMode="url"
                      name="livekit-url"
                      value={livekitForm.livekitUrl}
                      onChange={(event) =>
                        setLivekitForm((current) => ({ ...current, livekitUrl: event.target.value }))
                      }
                      placeholder={t("LIVEKIT_URL（必填）", "LIVEKIT_URL (required)")}
                    />
                    <input
                      {...manualInputProps}
                      name="livekit-api-key"
                      value={livekitForm.livekitApiKey}
                      onChange={(event) =>
                        setLivekitForm((current) => ({
                          ...current,
                          livekitApiKey: event.target.value,
                        }))
                      }
                      placeholder="LIVEKIT_API_KEY"
                    />
                    <input
                      {...manualSecretInputProps}
                      type="password"
                      name="livekit-api-secret"
                      value={livekitForm.livekitApiSecret}
                      onChange={(event) =>
                        setLivekitForm((current) => ({
                          ...current,
                          livekitApiSecret: event.target.value,
                        }))
                      }
                      placeholder="LIVEKIT_API_SECRET"
                    />
                    <div className="key-form-actions">
                      <button type="submit" className="primary-btn" disabled={livekitLoading}>
                        {livekitLoading ? t("保存中...", "Saving...") : t("保存配置", "Save Settings")}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={livekitLoading}
                        onClick={() => void clearLivekit()}
                      >
                        {t("清空", "Clear")}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={livekitLoading}
                        onClick={() =>
                          void refreshLivekitStatus().catch((error) =>
                            setLivekitError((error as Error).message),
                          )
                        }
                      >
                        {t("刷新状态", "Refresh status")}
                      </button>
                    </div>
                  </form>
                  {livekitError ? <p className="form-error">{livekitError}</p> : null}
                </div>
              )}
            </details>

            <details className="minimal-details">
              <summary>{t("配置实时转录", "Configure Realtime Transcription")}</summary>
              {!isAuthenticated ? (
                <div className="details-content">
                  <p className="panel-tip">
                    {t(
                      "登录后可分别保存不同转录平台的 Key，并设置自己的默认实时转录工具。",
                      "Sign in to store different transcription provider keys separately and choose your default realtime transcription tool.",
                    )}
                  </p>
                </div>
              ) : (
                <div className="details-content">
                  <p className="panel-tip">
                    {t("默认转录工具", "Default provider")}:{" "}
                    {transcriptionStatus?.defaultProvider
                      ? providerLabel(transcriptionStatus.defaultProvider, language)
                      : t("未设置", "Not selected")}
                    。
                    {t(
                      "房主在用户 Key 模式（true / full）下，必须同时拥有完整的 LiveKit 配置和默认转录工具配置，否则开启语音实时转录时会直接报错。平台 Key 与用户自己的 Key 不会混合使用。",
                      "When user-key mode is enabled (true / full), the room owner must have both a complete LiveKit setup and a configured default transcription provider, otherwise live voice transcription fails immediately. Platform keys and user keys are never mixed.",
                    )}
                  </p>
                  <div className="key-form-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={transcriptionLoading !== null}
                      onClick={() =>
                        void refreshTranscriptionStatus().catch((error) =>
                          setTranscriptionError((error as Error).message),
                        )
                      }
                    >
                      {t("刷新状态", "Refresh status")}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={transcriptionLoading !== null || !transcriptionStatus?.defaultProvider}
                      onClick={() => void setDefaultProvider(null)}
                    >
                      {t("清除默认值", "Clear default")}
                    </button>
                  </div>

                  {PROVIDERS.map((provider) => {
                    const providerStatus = providerMap.get(provider);
                    const isDefault = transcriptionStatus?.defaultProvider === provider;

                    return (
                      <section
                        key={provider}
                        className="key-status-grid"
                        style={{ gap: "12px", background: "var(--card)", border: "1px solid var(--line)" }}
                      >
                        <div>
                          <h4 style={{ margin: 0 }}>{providerLabel(provider, language)}</h4>
                          <p className="panel-tip" style={{ marginTop: "6px" }}>
                            {t("当前状态", "Current status")}:{" "}
                            {configuredLabel(Boolean(providerStatus?.configured), language)}
                          </p>
                          <p className="panel-tip" style={{ marginTop: "6px" }}>
                            API Key: {providerStatus?.credentialMask ?? t("未配置", "Not configured")}
                          </p>
                          {provider === "dashscope" ? (
                            <p className="panel-tip" style={{ marginTop: "6px" }}>
                              {t("默认模型", "Default model")}: {DASHSCOPE_DEFAULT_MODEL}
                            </p>
                          ) : null}
                        </div>
                        <form
                          className="key-form"
                          onSubmit={(event) => void saveTranscription(event, provider)}
                          autoComplete="off"
                        >
                          <input
                            {...manualSecretInputProps}
                            type="password"
                            name={`${provider}-api-key`}
                            value={transcriptionForm[provider]}
                            onChange={(event) =>
                              setTranscriptionForm((current) => ({
                                ...current,
                                [provider]: event.target.value,
                              }))
                            }
                            placeholder={provider === "dashscope" ? "DASHSCOPE_API_KEY" : "DEEPGRAM_API_KEY"}
                          />
                          {provider === "dashscope" ? (
                            <p className="panel-tip" style={{ marginTop: 0 }}>
                              {t("请输入百炼 API Key，通常以 sk- 开头。", "Use a DashScope API key, which usually starts with sk-.")}
                            </p>
                          ) : null}
                          <div className="key-form-actions">
                            <button
                              type="submit"
                              className="primary-btn"
                              disabled={transcriptionLoading !== null}
                            >
                              {transcriptionLoading === `save:${provider}`
                                ? t("保存中...", "Saving...")
                                : t("保存配置", "Save Settings")}
                            </button>
                            <button
                              type="button"
                              className="ghost-btn"
                              disabled={transcriptionLoading !== null}
                              onClick={() => void clearTranscription(provider)}
                            >
                              {transcriptionLoading === `clear:${provider}`
                                ? t("清空中...", "Clearing...")
                                : t("清空", "Clear")}
                            </button>
                            <button
                              type="button"
                              className={isDefault ? "primary-btn" : "ghost-btn"}
                              disabled={transcriptionLoading !== null || !providerStatus?.configured}
                              onClick={() => void setDefaultProvider(provider)}
                            >
                              {transcriptionLoading === `default:${provider}`
                                ? t("保存中...", "Saving...")
                                : isDefault
                                  ? t("默认工具", "Default")
                                  : t("设为默认", "Set default")}
                            </button>
                          </div>
                        </form>
                      </section>
                    );
                  })}

                  {transcriptionError ? <p className="form-error">{transcriptionError}</p> : null}
                </div>
              )}
            </details>

            <details className="minimal-details">
              <summary>{t("配置分析 LLM", "Configure Analysis LLM")}</summary>
              {!isAuthenticated ? (
                <div className="details-content">
                  <p className="panel-tip">
                    {t(
                      "登录后可单独保存你自己的分析 LLM 配置。",
                      "Sign in to store your own analysis LLM settings separately.",
                    )}
                  </p>
                </div>
              ) : (
                <div className="details-content">
                  <p className="panel-tip">
                    {t("当前状态", "Current status")}:{" "}
                    {configuredLabel(Boolean(llmKeyStatus?.configured), language)}。
                    {t(
                      "这一组配置与 LiveKit/转录配置分开保存，仅在 `CONVERSATION_LLM_PROVIDER=openai-compatible` 时用于房间分析。",
                      "This set is stored separately from LiveKit/transcription settings and is used for room analysis only when `CONVERSATION_LLM_PROVIDER=openai-compatible`.",
                    )}
                  </p>
                  <div className="key-status-grid">
                    <span>LLM URL: {llmKeyStatus?.baseUrlMask ?? t("未配置", "Not configured")}</span>
                    <span>LLM API Key: {llmKeyStatus?.apiKeyMask ?? t("未配置", "Not configured")}</span>
                    <span>LLM Model: {llmKeyStatus?.model ?? t("未配置", "Not configured")}</span>
                  </div>
                  <form className="key-form" onSubmit={saveLlm} autoComplete="off">
                    <input
                      {...manualInputProps}
                      type="url"
                      inputMode="url"
                      name="conversation-llm-base-url"
                      value={llmForm.baseUrl}
                      onChange={(event) => setLlmForm((current) => ({ ...current, baseUrl: event.target.value }))}
                      placeholder={t(
                        "CONVERSATION_LLM_OPENAI_BASE_URL（必填）",
                        "CONVERSATION_LLM_OPENAI_BASE_URL (required)",
                      )}
                    />
                    <input
                      {...manualSecretInputProps}
                      type="password"
                      name="conversation-llm-api-key"
                      value={llmForm.apiKey}
                      onChange={(event) => setLlmForm((current) => ({ ...current, apiKey: event.target.value }))}
                      placeholder="CONVERSATION_LLM_OPENAI_API_KEY"
                    />
                    <input
                      {...manualInputProps}
                      name="conversation-llm-model"
                      value={llmForm.model}
                      onChange={(event) => setLlmForm((current) => ({ ...current, model: event.target.value }))}
                      placeholder="CONVERSATION_LLM_OPENAI_MODEL"
                    />
                    <div className="key-form-actions">
                      <button type="submit" className="primary-btn" disabled={llmLoading}>
                        {llmLoading ? t("保存中...", "Saving...") : t("保存配置", "Save Settings")}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={llmLoading}
                        onClick={() => void clearLlm()}
                      >
                        {t("清空", "Clear")}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={llmLoading}
                        onClick={() =>
                          void refreshLlmStatus().catch((error) => setLlmError((error as Error).message))
                        }
                      >
                        {t("刷新状态", "Refresh status")}
                      </button>
                    </div>
                  </form>
                  {llmError ? <p className="form-error">{llmError}</p> : null}
                </div>
              )}
            </details>
              </>
            ) : null}
          </section>
        </section>
      </main>

      {authMode ? (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true">
          <section className="auth-modal">
            <header className="auth-modal-header">
              <h2>{authTitle}</h2>
              <button
                type="button"
                className="close-btn"
                onClick={() => {
                  setAuthMode(null);
                  setAuthError("");
                }}
              >
                {t("关闭", "Close")}
              </button>
            </header>

            <div className="auth-switch-row">
              <button
                type="button"
                className={authMode === "login" ? "switch-btn active" : "switch-btn"}
                onClick={() => setAuthMode("login")}
              >
                {t("登录", "Sign In")}
              </button>
              <button
                type="button"
                className={authMode === "register" ? "switch-btn active" : "switch-btn"}
                onClick={() => setAuthMode("register")}
              >
                {t("注册", "Sign Up")}
              </button>
            </div>

            {authNextPath ? (
              <p className="panel-tip">
                {t("登录后将继续访问：", "After signing in, you will continue to: ")}
                {authNextPath}
              </p>
            ) : null}

            <form className="auth-form modal-auth-form" onSubmit={handleAuthSubmit}>
              <label htmlFor="auth-username">{t("用户名", "Username")}</label>
              <input
                id="auth-username"
                value={authForm.username}
                onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
                placeholder={t("3-32 位：小写字母/数字/_", "3-32 chars: lowercase letters/numbers/_")}
                autoComplete="username"
              />

              <label htmlFor="auth-password">{t("密码", "Password")}</label>
              <input
                id="auth-password"
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={t("至少 6 位", "At least 6 characters")}
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
              />

              <button type="submit" className="primary-btn" disabled={authLoading}>
                {authLoading ? `${authTitle}${t("中...", "...")}` : authTitle}
              </button>
            </form>

            {authError ? <p className="form-error">{authError}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
