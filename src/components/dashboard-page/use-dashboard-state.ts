"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import {
  emptyProviderForm,
  isBlank,
  normalizeNextPath,
  type AuthFormState,
  type AuthResponse,
  type DashboardPageClientProps,
  type DashboardResponse,
  type DashboardTranslate,
  type LivekitFormState,
  type LivekitStatus,
  type LlmFormState,
  type LlmKeyStatus,
  type RoomAction,
  type StatusResponse,
  type TranscriptionProviderName,
  type TranscriptionSettingsStatus,
  type UserInfo,
  type UsageSummary,
} from "./dashboard-page-support";

type UseDashboardStateArgs = DashboardPageClientProps & {
  t: DashboardTranslate;
};

export function useDashboardState({
  initialUser,
  initialCreatedRooms,
  initialJoinedRooms,
  initialLivekitStatus,
  initialTranscriptionStatus,
  initialLlmKeyStatus,
  initialUsageSummary,
  initialAuthMode,
  initialNextPath,
  t,
}: UseDashboardStateArgs) {
  const router = useRouter();

  const [user, setUser] = useState<UserInfo | null>(initialUser);
  const [createdRooms, setCreatedRooms] = useState(initialCreatedRooms);
  const [joinedRooms, setJoinedRooms] = useState(initialJoinedRooms);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(initialUsageSummary);
  const [roomIdToJoin, setRoomIdToJoin] = useState("");
  const [roomActionError, setRoomActionError] = useState("");
  const [roomActionLoading, setRoomActionLoading] = useState<RoomAction | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const [livekitStatus, setLivekitStatus] = useState<LivekitStatus | null>(initialLivekitStatus);
  const [livekitForm, setLivekitForm] = useState<LivekitFormState>({
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
  const [llmForm, setLlmForm] = useState<LlmFormState>({ baseUrl: "", apiKey: "", model: "" });
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState("");

  const [authMode, setAuthMode] = useState(initialAuthMode);
  const [authNextPath, setAuthNextPath] = useState<string | null>(normalizeNextPath(initialNextPath));
  const [authForm, setAuthForm] = useState<AuthFormState>({ username: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pendingRoomAction, setPendingRoomAction] = useState<RoomAction | null>(null);

  const isAuthenticated = Boolean(user);
  const hasHistory = createdRooms.length > 0 || joinedRooms.length > 0;
  const authTitle = authMode === "register" ? t("注册", "Sign Up") : t("登录", "Sign In");

  function openAuthModal(mode: NonNullable<typeof authMode>, nextPath?: string | null) {
    setAuthMode(mode);
    setAuthError("");
    if (typeof nextPath !== "undefined") {
      setAuthNextPath(normalizeNextPath(nextPath));
    }
  }

  function openLoginModal(nextPath?: string | null) {
    setPendingRoomAction(null);
    openAuthModal("login", nextPath);
  }

  function openRegisterModal(nextPath?: string | null) {
    setPendingRoomAction(null);
    openAuthModal("register", nextPath);
  }

  function closeAuthModal() {
    setAuthMode(null);
    setAuthError("");
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
      getProtected<DashboardResponse>(
        "/api/rooms/dashboard",
        t("获取历史房间失败", "Failed to load room history"),
      ),
      getProtected<StatusResponse<LivekitStatus>>(
        "/api/account/livekit",
        t("读取 LiveKit 状态失败", "Failed to read LiveKit status"),
      ),
      getProtected<StatusResponse<TranscriptionSettingsStatus>>(
        "/api/account/transcription",
        t("读取转录配置失败", "Failed to read transcription settings"),
      ),
      getProtected<StatusResponse<LlmKeyStatus>>(
        "/api/account/llm",
        t("读取 LLM 状态失败", "Failed to read LLM status"),
      ),
    ]);

    setCreatedRooms(dashboard.createdRooms);
    setJoinedRooms(dashboard.joinedRooms);
    setUsageSummary(dashboard.usage);
    setLivekitStatus(livekit.status);
    setTranscriptionStatus(transcription.status);
    setLlmKeyStatus(llm.status);
  }

  async function requireAuthForRoomAction(action: RoomAction) {
    if (isAuthenticated) {
      return true;
    }

    setPendingRoomAction(action);
    setRoomActionError(t("请先登录后再操作。", "Please sign in first."));
    openAuthModal("login");
    return false;
  }

  async function bootstrapRoom(action: RoomAction) {
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
      setRoomActionError(
        error instanceof Error ? error.message : t("获取历史房间失败", "Failed to load room history"),
      );
    } finally {
      setDashboardLoading(false);
    }
  }

  async function refreshLivekitStatus() {
    try {
      const payload = await getProtected<StatusResponse<LivekitStatus>>(
        "/api/account/livekit",
        t("读取 LiveKit 状态失败", "Failed to read LiveKit status"),
      );
      setLivekitStatus(payload.status);
    } catch (error) {
      setLivekitError(
        error instanceof Error ? error.message : t("读取 LiveKit 状态失败", "Failed to read LiveKit status"),
      );
    }
  }

  async function refreshTranscriptionStatus() {
    try {
      const payload = await getProtected<StatusResponse<TranscriptionSettingsStatus>>(
        "/api/account/transcription",
        t("读取转录配置失败", "Failed to read transcription settings"),
      );
      setTranscriptionStatus(payload.status);
    } catch (error) {
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : t("读取转录配置失败", "Failed to read transcription settings"),
      );
    }
  }

  async function refreshLlmStatus() {
    try {
      const payload = await getProtected<StatusResponse<LlmKeyStatus>>(
        "/api/account/llm",
        t("读取 LLM 状态失败", "Failed to read LLM status"),
      );
      setLlmKeyStatus(payload.status);
    } catch (error) {
      setLlmError(error instanceof Error ? error.message : t("读取 LLM 状态失败", "Failed to read LLM status"));
    }
  }

  async function saveLivekit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.values(livekitForm).some(isBlank)) {
      setLivekitError(
        t(
          "保存时必须同时填写 LiveKit URL、LiveKit API Key 和 LiveKit API Secret。",
          "LiveKit URL, LiveKit API key, and LiveKit API secret are required.",
        ),
      );
      return;
    }

    setLivekitLoading(true);
    setLivekitError("");

    try {
      const payload = await postProtected<StatusResponse<LivekitStatus>>(
        "/api/account/livekit",
        livekitForm,
        t("保存 LiveKit 配置失败", "Failed to save LiveKit settings"),
      );
      setLivekitStatus(payload.status);
      setLivekitForm({ livekitUrl: "", livekitApiKey: "", livekitApiSecret: "" });
    } catch (error) {
      setLivekitError(
        error instanceof Error ? error.message : t("保存 LiveKit 配置失败", "Failed to save LiveKit settings"),
      );
    } finally {
      setLivekitLoading(false);
    }
  }

  async function clearLivekit() {
    setLivekitLoading(true);
    setLivekitError("");

    try {
      const payload = await postProtected<StatusResponse<LivekitStatus>>(
        "/api/account/livekit",
        { clear: true },
        t("清空 LiveKit 配置失败", "Failed to clear LiveKit settings"),
      );
      setLivekitStatus(payload.status);
      setLivekitForm({ livekitUrl: "", livekitApiKey: "", livekitApiSecret: "" });
    } catch (error) {
      setLivekitError(
        error instanceof Error ? error.message : t("清空 LiveKit 配置失败", "Failed to clear LiveKit settings"),
      );
    } finally {
      setLivekitLoading(false);
    }
  }

  async function saveTranscription(
    event: FormEvent<HTMLFormElement>,
    provider: TranscriptionProviderName,
  ) {
    event.preventDefault();
    if (isBlank(transcriptionForm[provider])) {
      setTranscriptionError(t("API Key 为必填项。", "API key is required."));
      return;
    }

    setTranscriptionLoading(`save:${provider}`);
    setTranscriptionError("");

    try {
      const payload = await postProtected<StatusResponse<TranscriptionSettingsStatus>>(
        "/api/account/transcription",
        { action: "save", provider, apiKey: transcriptionForm[provider].trim() },
        t("保存转录配置失败", "Failed to save transcription settings"),
      );
      setTranscriptionStatus(payload.status);
      setTranscriptionForm((current) => ({ ...current, [provider]: "" }));
    } catch (error) {
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : t("保存转录配置失败", "Failed to save transcription settings"),
      );
    } finally {
      setTranscriptionLoading(null);
    }
  }

  async function clearTranscription(provider: TranscriptionProviderName) {
    setTranscriptionLoading(`clear:${provider}`);
    setTranscriptionError("");

    try {
      const payload = await postProtected<StatusResponse<TranscriptionSettingsStatus>>(
        "/api/account/transcription",
        { action: "clear", provider },
        t("清空转录配置失败", "Failed to clear transcription settings"),
      );
      setTranscriptionStatus(payload.status);
      setTranscriptionForm((current) => ({ ...current, [provider]: "" }));
    } catch (error) {
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : t("清空转录配置失败", "Failed to clear transcription settings"),
      );
    } finally {
      setTranscriptionLoading(null);
    }
  }

  async function setDefaultProvider(provider: TranscriptionProviderName | null) {
    setTranscriptionLoading(`default:${provider ?? "none"}`);
    setTranscriptionError("");

    try {
      const payload = await postProtected<StatusResponse<TranscriptionSettingsStatus>>(
        "/api/account/transcription",
        { action: "set-default", provider },
        t("更新默认转录工具失败", "Failed to update default transcription provider"),
      );
      setTranscriptionStatus(payload.status);
    } catch (error) {
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : t("更新默认转录工具失败", "Failed to update default transcription provider"),
      );
    } finally {
      setTranscriptionLoading(null);
    }
  }

  async function saveLlm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.values(llmForm).some(isBlank)) {
      setLlmError(
        t(
          "保存时必须同时填写 LLM URL、LLM API Key 和 LLM Model。",
          "LLM URL, LLM API key, and LLM model are required.",
        ),
      );
      return;
    }

    setLlmLoading(true);
    setLlmError("");

    try {
      const payload = await postProtected<StatusResponse<LlmKeyStatus>>(
        "/api/account/llm",
        llmForm,
        t("保存 LLM 配置失败", "Failed to save LLM settings"),
      );
      setLlmKeyStatus(payload.status);
      setLlmForm({ baseUrl: "", apiKey: "", model: "" });
    } catch (error) {
      setLlmError(
        error instanceof Error ? error.message : t("保存 LLM 配置失败", "Failed to save LLM settings"),
      );
    } finally {
      setLlmLoading(false);
    }
  }

  async function clearLlm() {
    setLlmLoading(true);
    setLlmError("");

    try {
      const payload = await postProtected<StatusResponse<LlmKeyStatus>>(
        "/api/account/llm",
        { clear: true },
        t("清空 LLM 配置失败", "Failed to clear LLM settings"),
      );
      setLlmKeyStatus(payload.status);
      setLlmForm({ baseUrl: "", apiKey: "", model: "" });
    } catch (error) {
      setLlmError(
        error instanceof Error ? error.message : t("清空 LLM 配置失败", "Failed to clear LLM settings"),
      );
    } finally {
      setLlmLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearDataAfterLogout();
  }

  return {
    authError,
    authForm,
    authLoading,
    authMode,
    authNextPath,
    authTitle,
    clearLlm,
    clearLivekit,
    clearTranscription,
    closeAuthModal,
    createdRooms,
    dashboardLoading,
    handleAuthSubmit,
    handleCreateRoom,
    handleJoinRoom,
    handleLogout,
    hasHistory,
    isAuthenticated,
    joinedRooms,
    livekitError,
    livekitForm,
    livekitLoading,
    livekitStatus,
    llmError,
    llmForm,
    llmKeyStatus,
    llmLoading,
    openLoginModal,
    openRegisterModal,
    refreshDashboard,
    refreshLivekitStatus,
    refreshLlmStatus,
    refreshTranscriptionStatus,
    roomActionError,
    roomActionLoading,
    roomIdToJoin,
    saveLivekit,
    saveLlm,
    saveTranscription,
    setAuthForm,
    setAuthMode,
    setDefaultProvider,
    setLivekitForm,
    setLlmForm,
    setRoomIdToJoin,
    setTranscriptionForm,
    transcriptionError,
    transcriptionForm,
    transcriptionLoading,
    transcriptionStatus,
    usageSummary,
    user,
  };
}

export type DashboardState = ReturnType<typeof useDashboardState>;
