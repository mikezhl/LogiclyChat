"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUiLanguage } from "@/lib/use-ui-language";
import { toDateLocale, type UiLanguage } from "@/lib/ui-language";

type RoomSummary = {
  roomId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  participantCount: number;
  messageCount: number;
  joinedAt?: string;
};

type KeyStatus = {
  configured: boolean;
  livekitUrlMask: string | null;
  livekitApiKeyMask: string | null;
  livekitApiSecretMask: string | null;
  deepgramApiKeyMask: string | null;
};

type DashboardResponse = {
  createdRooms: RoomSummary[];
  joinedRooms: RoomSummary[];
  error?: string;
};

type KeyStatusResponse = {
  status: KeyStatus;
  error?: string;
};

type LlmKeyStatus = {
  configured: boolean;
  baseUrlMask: string | null;
  apiKeyMask: string | null;
  model: string | null;
};

type LlmKeyStatusResponse = {
  status: LlmKeyStatus;
  error?: string;
};

type AuthResponse = {
  user?: {
    id: string;
    username: string;
  };
  error?: string;
};

type UserInfo = {
  id: string;
  username: string;
};

type AuthMode = "login" | "register";

type DashboardPageClientProps = {
  initialUser: UserInfo | null;
  initialCreatedRooms: RoomSummary[];
  initialJoinedRooms: RoomSummary[];
  initialKeyStatus: KeyStatus | null;
  initialLlmKeyStatus: LlmKeyStatus | null;
  initialAuthMode: AuthMode | null;
  initialNextPath: string | null;
};

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

function roomStatusLabel(status: string, language: UiLanguage) {
  if (status === "ENDED") {
    return language === "zh" ? "已结束" : "Ended";
  }
  return language === "zh" ? "进行中" : "Active";
}

function normalizeNextPath(raw: string | null | undefined) {
  if (!raw || !raw.startsWith("/")) {
    return null;
  }
  return raw;
}

function isBlank(value: string) {
  return value.trim().length === 0;
}

export default function DashboardPageClient({
  initialUser,
  initialCreatedRooms,
  initialJoinedRooms,
  initialKeyStatus,
  initialLlmKeyStatus,
  initialAuthMode,
  initialNextPath,
}: DashboardPageClientProps) {
  const router = useRouter();
  const { language, setLanguage } = useUiLanguage();
  const isZh = language === "zh";
  const t = (zh: string, en: string) => (isZh ? zh : en);
  const toggleLanguage = () => setLanguage(isZh ? "en" : "zh");
  const [user, setUser] = useState<UserInfo | null>(initialUser);

  const [createdRooms, setCreatedRooms] = useState(initialCreatedRooms);
  const [joinedRooms, setJoinedRooms] = useState(initialJoinedRooms);
  const [roomIdToJoin, setRoomIdToJoin] = useState("");
  const [roomActionError, setRoomActionError] = useState("");
  const [roomActionLoading, setRoomActionLoading] = useState<"create" | "join" | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(initialKeyStatus);
  const [keyForm, setKeyForm] = useState({
    livekitUrl: "",
    livekitApiKey: "",
    livekitApiSecret: "",
    deepgramApiKey: "",
  });
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [llmKeyStatus, setLlmKeyStatus] = useState<LlmKeyStatus | null>(initialLlmKeyStatus);
  const [llmForm, setLlmForm] = useState({
    baseUrl: "",
    apiKey: "",
    model: "",
  });
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState("");

  const [authMode, setAuthMode] = useState<AuthMode | null>(initialAuthMode);
  const [authNextPath, setAuthNextPath] = useState<string | null>(normalizeNextPath(initialNextPath));
  const [authForm, setAuthForm] = useState({
    username: "",
    password: "",
  });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pendingRoomAction, setPendingRoomAction] = useState<"create" | "join" | null>(null);

  const isAuthenticated = Boolean(user);
  const hasHistory = createdRooms.length > 0 || joinedRooms.length > 0;
  const authTitle = authMode === "register" ? t("注册", "Sign Up") : t("登录", "Sign In");

  const heroSubtitle = useMemo(() => {
    if (!isAuthenticated) {
      return isZh
        ? "一个实时的 AI 辩论/吵架辅助 + 分析 + 总结平台"
        : "A real-time AI debate and argument copilot for assist, analysis, and summaries.";
    }
    return isZh
      ? `你好，${user!.username}。可以直接创建或加入房间。`
      : `Hi, ${user!.username}. You can create or join a room right away.`;
  }, [isAuthenticated, isZh, user]);

  function openAuthModal(mode: AuthMode, nextPath?: string | null) {
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
    setKeyStatus(null);
    setLlmKeyStatus(null);
    setKeyError("");
    setLlmError("");
    setKeyForm({
      livekitUrl: "",
      livekitApiKey: "",
      livekitApiSecret: "",
      deepgramApiKey: "",
    });
    setLlmForm({
      baseUrl: "",
      apiKey: "",
      model: "",
    });
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

  async function refreshDashboard() {
    if (!isAuthenticated) {
      return;
    }

    setDashboardLoading(true);
    setRoomActionError("");
    try {
      const response = await fetch("/api/rooms/dashboard", { cache: "no-store" });
      const payload = (await response.json()) as DashboardResponse;
      if (!response.ok) {
        if (response.status === 401) {
          clearDataAfterLogout();
          openAuthModal("login");
        }
        throw new Error(payload.error ?? t("获取历史房间失败", "Failed to load room history"));
      }

      setCreatedRooms(payload.createdRooms);
      setJoinedRooms(payload.joinedRooms);
    } catch (error) {
      setRoomActionError(
        error instanceof Error ? error.message : t("获取历史房间失败", "Failed to load room history"),
      );
    } finally {
      setDashboardLoading(false);
    }
  }

  async function refreshKeyStatus() {
    if (!isAuthenticated) {
      return;
    }

    const response = await fetch("/api/account/keys", { cache: "no-store" });
    const payload = (await response.json()) as KeyStatusResponse;
    if (!response.ok) {
      if (response.status === 401) {
        clearDataAfterLogout();
        openAuthModal("login");
      }
      throw new Error(payload.error ?? t("读取 Key 状态失败", "Failed to read key status"));
    }
    setKeyStatus(payload.status);
  }

  async function refreshLlmKeyStatus() {
    if (!isAuthenticated) {
      return;
    }

    const response = await fetch("/api/account/llm", { cache: "no-store" });
    const payload = (await response.json()) as LlmKeyStatusResponse;
    if (!response.ok) {
      if (response.status === 401) {
        clearDataAfterLogout();
        openAuthModal("login");
      }
      throw new Error(payload.error ?? t("读取 LLM 状态失败", "Failed to read LLM status"));
    }
    setLlmKeyStatus(payload.status);
  }

  async function loadAuthenticatedData() {
    const [dashboardResponse, keyResponse, llmResponse] = await Promise.all([
      fetch("/api/rooms/dashboard", { cache: "no-store" }),
      fetch("/api/account/keys", { cache: "no-store" }),
      fetch("/api/account/llm", { cache: "no-store" }),
    ]);

    const dashboardPayload = (await dashboardResponse.json()) as DashboardResponse;
    const keyPayload = (await keyResponse.json()) as KeyStatusResponse;
    const llmPayload = (await llmResponse.json()) as LlmKeyStatusResponse;

    if (!dashboardResponse.ok) {
      throw new Error(dashboardPayload.error ?? t("获取历史房间失败", "Failed to load room history"));
    }
    if (!keyResponse.ok) {
      throw new Error(keyPayload.error ?? t("读取 Key 状态失败", "Failed to read key status"));
    }

    setCreatedRooms(dashboardPayload.createdRooms);
    setJoinedRooms(dashboardPayload.joinedRooms);
    setKeyStatus(keyPayload.status);
    if (!llmResponse.ok) {
      throw new Error(llmPayload.error ?? t("读取 LLM 状态失败", "Failed to read LLM status"));
    }
    setLlmKeyStatus(llmPayload.status);
  }

  async function bootstrapRoom(action: "create" | "join") {
    if (action === "join" && roomIdToJoin.trim().length === 0) {
      setRoomActionError(t("请输入房间号。", "Please enter a room ID."));
      return;
    }

    setRoomActionLoading(action);
    setRoomActionError("");

    try {
      const response = await fetch("/api/rooms/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          action === "create"
            ? JSON.stringify({ action: "create" })
            : JSON.stringify({ action: "join", roomId: roomIdToJoin.trim() }),
      });

      const payload = (await response.json()) as { roomId?: string; error?: string };
      if (!response.ok || !payload.roomId) {
        if (response.status === 401) {
          setPendingRoomAction(action);
          openAuthModal("login");
        }
        throw new Error(payload.error ?? t("房间操作失败", "Room action failed"));
      }

      setPendingRoomAction(null);
      router.push(`/${encodeURIComponent(payload.roomId)}`);
    } catch (error) {
      setRoomActionError(
        error instanceof Error ? error.message : t("房间操作失败", "Room action failed"),
      );
    } finally {
      setRoomActionLoading(null);
    }
  }

  async function handleCreateRoom() {
    const canContinue = await requireAuthForRoomAction("create");
    if (!canContinue) {
      return;
    }
    await bootstrapRoom("create");
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const canContinue = await requireAuthForRoomAction("join");
    if (!canContinue) {
      return;
    }
    await bootstrapRoom("join");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authMode) {
      return;
    }

    setAuthLoading(true);
    setAuthError("");

    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? `${authTitle}${t("失败", " failed")}`);
      }

      setUser(payload.user);
      setAuthMode(null);
      setAuthForm({
        username: "",
        password: "",
      });

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

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearDataAfterLogout();
  }

  async function handleKeySave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }

    if (
      isBlank(keyForm.livekitUrl) ||
      isBlank(keyForm.livekitApiKey) ||
      isBlank(keyForm.livekitApiSecret) ||
      isBlank(keyForm.deepgramApiKey)
    ) {
      setKeyError(
        t(
          "保存时必须同时填写 LiveKit URL、LiveKit API Key、LiveKit API Secret 和 Deepgram API Key。清空请点击“清空”。",
          'LiveKit URL, LiveKit API Key, LiveKit API Secret, and Deepgram API Key are all required. Use "Clear" to remove saved keys.',
        ),
      );
      return;
    }

    setKeyLoading(true);
    setKeyError("");

    try {
      const response = await fetch("/api/account/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keyForm),
      });
      const payload = (await response.json()) as KeyStatusResponse;
      if (!response.ok) {
        if (response.status === 401) {
          clearDataAfterLogout();
          openAuthModal("login");
        }
        throw new Error(payload.error ?? t("保存 Key 失败", "Failed to save key"));
      }
      setKeyStatus(payload.status);
      setKeyForm({
        livekitUrl: "",
        livekitApiKey: "",
        livekitApiSecret: "",
        deepgramApiKey: "",
      });
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : t("保存 Key 失败", "Failed to save key"));
    } finally {
      setKeyLoading(false);
    }
  }

  async function handleKeyClear() {
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }

    setKeyLoading(true);
    setKeyError("");

    try {
      const response = await fetch("/api/account/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const payload = (await response.json()) as KeyStatusResponse;
      if (!response.ok) {
        if (response.status === 401) {
          clearDataAfterLogout();
          openAuthModal("login");
        }
        throw new Error(payload.error ?? t("清空 Key 失败", "Failed to clear key"));
      }
      setKeyStatus(payload.status);
      setKeyForm({
        livekitUrl: "",
        livekitApiKey: "",
        livekitApiSecret: "",
        deepgramApiKey: "",
      });
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : t("清空 Key 失败", "Failed to clear key"));
    } finally {
      setKeyLoading(false);
    }
  }

  async function handleLlmSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }

    if (isBlank(llmForm.baseUrl) || isBlank(llmForm.apiKey) || isBlank(llmForm.model)) {
      setLlmError(
        t(
          "保存时必须同时填写 LLM URL、LLM API Key 和 LLM Model。清空请点击“清空”。",
          'LLM URL, LLM API Key, and LLM Model are all required. Use "Clear" to remove saved keys.',
        ),
      );
      return;
    }

    setLlmLoading(true);
    setLlmError("");

    try {
      const response = await fetch("/api/account/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(llmForm),
      });
      const payload = (await response.json()) as LlmKeyStatusResponse;
      if (!response.ok) {
        if (response.status === 401) {
          clearDataAfterLogout();
          openAuthModal("login");
        }
        throw new Error(payload.error ?? t("保存 LLM 配置失败", "Failed to save LLM settings"));
      }
      setLlmKeyStatus(payload.status);
      setLlmForm({
        baseUrl: "",
        apiKey: "",
        model: "",
      });
    } catch (error) {
      setLlmError(
        error instanceof Error ? error.message : t("保存 LLM 配置失败", "Failed to save LLM settings"),
      );
    } finally {
      setLlmLoading(false);
    }
  }

  async function handleLlmClear() {
    if (!isAuthenticated) {
      openAuthModal("login");
      return;
    }

    setLlmLoading(true);
    setLlmError("");

    try {
      const response = await fetch("/api/account/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const payload = (await response.json()) as LlmKeyStatusResponse;
      if (!response.ok) {
        if (response.status === 401) {
          clearDataAfterLogout();
          openAuthModal("login");
        }
        throw new Error(payload.error ?? t("清空 LLM 配置失败", "Failed to clear LLM settings"));
      }
      setLlmKeyStatus(payload.status);
      setLlmForm({
        baseUrl: "",
        apiKey: "",
        model: "",
      });
    } catch (error) {
      setLlmError(
        error instanceof Error ? error.message : t("清空 LLM 配置失败", "Failed to clear LLM settings"),
      );
    } finally {
      setLlmLoading(false);
    }
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
              <button
                type="button"
                className="ghost-btn lang-toggle-btn"
                aria-label={t("切换语言", "Switch language")}
                onClick={toggleLanguage}
              >
                {isZh ? "EN" : "中文"}
              </button>
              {isAuthenticated ? (
                <>
                  <span className="user-chip">{user?.username}</span>
                  <button type="button" className="ghost-btn" onClick={() => void handleLogout()}>
                    {t("退出登录", "Sign Out")}
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
                    : t("加入房间", "Join Room")}
                </button>
              </form>
            </div>
            {roomActionError ? <p className="form-error">{roomActionError}</p> : null}
          </section>

          <section className="minimal-details-wrap">
            <details className="minimal-details">
              <summary>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{t("查看历史房间", "Room History")}</span>
                  {isAuthenticated && (
                    <button
                      type="button"
                      title={t("刷新历史", "Refresh history")}
                      style={{
                        padding: '4px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--muted)',
                        cursor: dashboardLoading ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: dashboardLoading ? 0.5 : 1,
                        transition: 'opacity 0.2s, color 0.2s',
                        borderRadius: '4px'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--foreground)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
                      onClick={(e) => {
                        e.preventDefault();
                        if (!dashboardLoading) void refreshDashboard();
                      }}
                      disabled={dashboardLoading}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                        <path d="M21 3v5h-5"/>
                      </svg>
                    </button>
                  )}
                </div>
              </summary>
              {!isAuthenticated ? (
                <div className="details-content">
                  <p className="panel-tip">
                    {t(
                      "登录后可查看你创建和参与的房间记录。",
                      "Sign in to view rooms you created or joined.",
                    )}
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
                            {createdRooms.map((room) => (
                              <li key={`created-${room.roomId}`}>
                                <Link
                                  className="room-list-item"
                                  href={`/${encodeURIComponent(room.roomId)}`}
                                  aria-label={`${t("进入房间", "Open room")} ${room.roomId}`}
                                >
                                  <div className="room-list-item-copy">
                                    <strong>{room.roomId}</strong>
                                    <p>
                                      {t("成员", "Members")}: {room.participantCount} |{" "}
                                      {t("消息", "Messages")}: {room.messageCount}
                                    </p>
                                    <p>
                                      {t("创建", "Created")}: {formatDate(room.createdAt, language)}
                                    </p>
                                  </div>
                                  <span className="room-list-status" data-status={room.status}>
                                    {roomStatusLabel(room.status, language)}
                                  </span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="history-group">
                        <h3>{t("我参与的房间", "Rooms I Joined")}</h3>
                        {joinedRooms.length === 0 ? (
                          <p className="panel-tip">{t("暂无记录。", "No records.")}</p>
                        ) : (
                          <ul className="room-list">
                            {joinedRooms.map((room) => (
                              <li key={`joined-${room.roomId}`}>
                                <Link
                                  className="room-list-item"
                                  href={`/${encodeURIComponent(room.roomId)}`}
                                  aria-label={`${t("进入房间", "Open room")} ${room.roomId}`}
                                >
                                  <div className="room-list-item-copy">
                                    <strong>{room.roomId}</strong>
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
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </details>

            <details className="minimal-details">
              <summary>{t("配置 Provider Key", "Configure Provider Key")}</summary>
              {!isAuthenticated ? (
                <div className="details-content">
                  <p className="panel-tip">
                    {t(
                      "登录后可保存个人 LiveKit / Deepgram Key。",
                      "Sign in to store your own LiveKit / Deepgram keys.",
                    )}
                  </p>
                </div>
              ) : (
                <div className="details-content">
                  <p className="panel-tip">
                    {t("当前状态", "Current status")}:{" "}
                    {keyStatus?.configured ? t("已配置", "Configured") : t("未配置", "Not configured")}。
                    {t(
                      "仅保存到你的账户，不影响其他用户。保存时四项必须同时填写；若要删除，请点击“清空”。",
                      'Saved only to your account, without affecting other users. All four fields are required when saving; use "Clear" to remove them.',
                    )}
                  </p>
                  <div className="key-status-grid">
                    <span>
                      LiveKit URL: {keyStatus?.livekitUrlMask ?? t("未配置", "Not configured")}
                    </span>
                    <span>
                      LiveKit API Key: {keyStatus?.livekitApiKeyMask ?? t("未配置", "Not configured")}
                    </span>
                    <span>
                      LiveKit API Secret:{" "}
                      {keyStatus?.livekitApiSecretMask ?? t("未配置", "Not configured")}
                    </span>
                    <span>
                      Deepgram API Key: {keyStatus?.deepgramApiKeyMask ?? t("未配置", "Not configured")}
                    </span>
                  </div>
                  <form className="key-form" onSubmit={handleKeySave}>
                    <input
                      value={keyForm.livekitUrl}
                      onChange={(event) =>
                        setKeyForm((current) => ({ ...current, livekitUrl: event.target.value }))
                      }
                      placeholder={t("LIVEKIT_URL（必填）", "LIVEKIT_URL (required)")}
                    />
                    <input
                      value={keyForm.livekitApiKey}
                      onChange={(event) =>
                        setKeyForm((current) => ({ ...current, livekitApiKey: event.target.value }))
                      }
                      placeholder="LIVEKIT_API_KEY"
                    />
                    <input
                      type="password"
                      value={keyForm.livekitApiSecret}
                      onChange={(event) =>
                        setKeyForm((current) => ({ ...current, livekitApiSecret: event.target.value }))
                      }
                      placeholder="LIVEKIT_API_SECRET"
                    />
                    <input
                      type="password"
                      value={keyForm.deepgramApiKey}
                      onChange={(event) =>
                        setKeyForm((current) => ({ ...current, deepgramApiKey: event.target.value }))
                      }
                      placeholder="DEEPGRAM_API_KEY"
                    />
                    <div className="key-form-actions">
                      <button type="submit" className="primary-btn" disabled={keyLoading}>
                        {keyLoading ? t("保存中...", "Saving...") : t("保存 Key", "Save Key")}
                      </button>
                      <button type="button" className="ghost-btn" disabled={keyLoading} onClick={() => void handleKeyClear()}>
                        {t("清空", "Clear")}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={keyLoading}
                        onClick={() => void refreshKeyStatus().catch((error) => setKeyError((error as Error).message))}
                      >
                        {t("刷新状态", "Refresh status")}
                      </button>
                    </div>
                  </form>
                  {keyError ? <p className="form-error">{keyError}</p> : null}
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
                    {llmKeyStatus?.configured ? t("已配置", "Configured") : t("未配置", "Not configured")}。
                    {t(
                      "这一组配置与 LiveKit/Deepgram 分开保存，仅在 `CONVERSATION_LLM_PROVIDER=openai-compatible` 时用于房间分析。",
                      "This set is stored separately from LiveKit/Deepgram and is used for room analysis only when `CONVERSATION_LLM_PROVIDER=openai-compatible`.",
                    )}
                  </p>
                  <div className="key-status-grid">
                    <span>
                      LLM URL: {llmKeyStatus?.baseUrlMask ?? t("未配置", "Not configured")}
                    </span>
                    <span>
                      LLM API Key: {llmKeyStatus?.apiKeyMask ?? t("未配置", "Not configured")}
                    </span>
                    <span>
                      LLM Model: {llmKeyStatus?.model ?? t("未配置", "Not configured")}
                    </span>
                  </div>
                  <form className="key-form" onSubmit={handleLlmSave}>
                    <input
                      value={llmForm.baseUrl}
                      onChange={(event) =>
                        setLlmForm((current) => ({ ...current, baseUrl: event.target.value }))
                      }
                      placeholder={t(
                        "CONVERSATION_LLM_OPENAI_BASE_URL（必填）",
                        "CONVERSATION_LLM_OPENAI_BASE_URL (required)",
                      )}
                    />
                    <input
                      type="password"
                      value={llmForm.apiKey}
                      onChange={(event) =>
                        setLlmForm((current) => ({ ...current, apiKey: event.target.value }))
                      }
                      placeholder="CONVERSATION_LLM_OPENAI_API_KEY"
                    />
                    <input
                      value={llmForm.model}
                      onChange={(event) =>
                        setLlmForm((current) => ({ ...current, model: event.target.value }))
                      }
                      placeholder="CONVERSATION_LLM_OPENAI_MODEL"
                    />
                    <div className="key-form-actions">
                      <button type="submit" className="primary-btn" disabled={llmLoading}>
                        {llmLoading ? t("保存中...", "Saving...") : t("保存 LLM 配置", "Save LLM Settings")}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={llmLoading}
                        onClick={() => void handleLlmClear()}
                      >
                        {t("清空", "Clear")}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={llmLoading}
                        onClick={() =>
                          void refreshLlmKeyStatus().catch((error) => setLlmError((error as Error).message))
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
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                placeholder={t("3-32 位：小写字母/数字/_", "3-32 chars: lowercase letters/numbers/_")}
                autoComplete="username"
              />

              <label htmlFor="auth-password">{t("密码", "Password")}</label>
              <input
                id="auth-password"
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
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
