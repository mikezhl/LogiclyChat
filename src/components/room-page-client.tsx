"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ParticipantKind, Room, RoomEvent, Track } from "livekit-client";

import { ChatMessage } from "@/lib/chat-types";
import { decodeLivekitChatMessageEvent, LIVEKIT_CHAT_MESSAGE_TOPIC } from "@/lib/livekit-chat-event";
import { useUiLanguage } from "@/lib/use-ui-language";
import { toDateLocale, type UiLanguage } from "@/lib/ui-language";

type TokenResponse = {
  token: string;
  livekitUrl: string;
  identity: string;
  displayName: string;
  transcriberEnabled: boolean;
  providers: {
    voice: {
      providedBy: {
        kind: "platform" | "user" | "builtin" | "unavailable";
        username: string | null;
      };
      transportProvider: string;
      transportSource: "user" | "system" | "unavailable";
      transportCredentialMask: string | null;
      transportReady: boolean;
      transcriptionEnabled: boolean;
      transcriptionProvider: string | null;
      transcriptionSource: "user" | "system" | "unavailable";
      transcriptionCredentialMask: string | null;
      transcriptionReady: boolean;
    };
    analysis: {
      providedBy: {
        kind: "platform" | "user" | "builtin" | "unavailable";
        username: string | null;
      };
      provider: string;
      source: "user" | "system" | "unavailable" | "builtin";
      credentialMask: string | null;
      model: string | null;
      ready: boolean;
      profiles: {
        realtime: string;
        summary: string;
      };
    };
  };
  error?: string;
};

type MessagesResponse = {
  messages: ChatMessage[];
  error?: string;
};

type RoomMetaResponse = {
  room: {
    roomId: string;
    status: "ACTIVE" | "ENDED";
    endedAt: string | null;
    isCreator: boolean;
  };
  providers: {
    voice: {
      providedBy: {
        kind: "platform" | "user" | "builtin" | "unavailable";
        username: string | null;
      };
      transportProvider: string;
      transportSource: "user" | "system" | "unavailable";
      transportCredentialMask: string | null;
      transportReady: boolean;
      transcriptionEnabled: boolean;
      transcriptionProvider: string | null;
      transcriptionSource: "user" | "system" | "unavailable";
      transcriptionCredentialMask: string | null;
      transcriptionReady: boolean;
    };
    analysis: {
      providedBy: {
        kind: "platform" | "user" | "builtin" | "unavailable";
        username: string | null;
      };
      provider: string;
      source: "user" | "system" | "unavailable" | "builtin";
      credentialMask: string | null;
      model: string | null;
      ready: boolean;
      profiles: {
        realtime: string;
        summary: string;
      };
    };
  };
  error?: string;
};

type RoomPageClientProps = {
  roomId: string;
  username: string;
};

type TranscriptionState = "idle" | "starting" | "ready" | "disabled";

type RoomMetaState = {
  status: "ACTIVE" | "ENDED";
  endedAt: string | null;
  isCreator: boolean;
  providers: {
    voice: {
      providedBy: {
        kind: "platform" | "user" | "builtin" | "unavailable";
        username: string | null;
      };
      transportProvider: string;
      transportSource: "user" | "system" | "unavailable";
      transportCredentialMask: string | null;
      transportReady: boolean;
      transcriptionEnabled: boolean;
      transcriptionProvider: string | null;
      transcriptionSource: "user" | "system" | "unavailable";
      transcriptionCredentialMask: string | null;
      transcriptionReady: boolean;
    };
    analysis: {
      providedBy: {
        kind: "platform" | "user" | "builtin" | "unavailable";
        username: string | null;
      };
      provider: string;
      source: "user" | "system" | "unavailable" | "builtin";
      credentialMask: string | null;
      model: string | null;
      ready: boolean;
      profiles: {
        realtime: string;
        summary: string;
      };
    };
  };
};

function formatDate(value: string | null, language: UiLanguage) {
  if (!value) {
    return language === "zh" ? "暂无" : "N/A";
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

function formatTime(value: string, language: UiLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(toDateLocale(language), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    map.set(message.id, message);
  }
  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function isOwnMessage(message: ChatMessage, participantId: string, username: string) {
  if (message.type === "analysis" || message.type === "summary") {
    return false;
  }

  if (message.senderName === username) {
    return true;
  }

  if (participantId && message.participantId) {
    return message.participantId === participantId;
  }

  return false;
}

function formatProviderName(value: string, language: UiLanguage) {
  if (!value) {
    return language === "zh" ? "未配置" : "Not configured";
  }

  if (value === "mock") {
    return "Mock";
  }

  return value;
}

function formatProviderOwner(
  owner: RoomMetaState["providers"]["voice"]["providedBy"],
  language: UiLanguage,
) {
  if (owner.kind === "user") {
    return owner.username ?? (language === "zh" ? "用户" : "User");
  }
  if (owner.kind === "platform" || owner.kind === "builtin") {
    return language === "zh" ? "平台" : "Platform";
  }

  return language === "zh" ? "未配置" : "Unavailable";
}

function formatProviderValue(
  value: string | null | undefined,
  language: UiLanguage,
) {
  if (value && value.trim().length > 0) {
    return value;
  }

  return language === "zh" ? "未设置" : "Not set";
}

function getVoiceProviderLabel(voice: RoomMetaState["providers"]["voice"], language: UiLanguage) {
  return formatProviderOwner(voice.providedBy, language);
}

function getAnalysisProviderLabel(
  analysis: RoomMetaState["providers"]["analysis"],
  language: UiLanguage,
) {
  return formatProviderOwner(analysis.providedBy, language);
}

function getVoiceProviderDetails(
  voice: RoomMetaState["providers"]["voice"],
  language: UiLanguage,
) {
  return [
    {
      label: language === "zh" ? "语音通道" : "Voice transport",
      value: formatProviderName(voice.transportProvider, language),
    },
    {
      label: language === "zh" ? "转录引擎" : "Transcription",
      value: voice.transcriptionEnabled
        ? formatProviderName(voice.transcriptionProvider ?? "", language)
        : language === "zh"
          ? "已关闭"
          : "Disabled",
    },
  ];
}

function getAnalysisProviderDetails(
  analysis: RoomMetaState["providers"]["analysis"],
  language: UiLanguage,
) {
  const details = [
    {
      label: language === "zh" ? "实现" : "Implementation",
      value: formatProviderName(analysis.provider, language),
    },
    {
      label: language === "zh" ? "实时 Profile" : "Realtime profile",
      value: analysis.profiles.realtime,
    },
    {
      label: language === "zh" ? "总结 Profile" : "Summary profile",
      value: analysis.profiles.summary,
    },
  ];

  if (analysis.model) {
    details.push({
      label: language === "zh" ? "模型" : "Model",
      value: formatProviderValue(analysis.model, language),
    });
  }

  return details;
}

export default function RoomPageClient({ roomId, username }: RoomPageClientProps) {
  const { language } = useUiLanguage();
  const isZh = language === "zh";
  const t = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);

  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const warmupRequestedRef = useRef(false);
  const autoConnectAttemptedRef = useRef(false);
  const connectStartedAtRef = useRef<number | null>(null);
  const latestMessageCreatedAtRef = useRef<string | null>(null);

  const [roomMeta, setRoomMeta] = useState<RoomMetaState>({
    status: "ACTIVE",
    endedAt: null,
    isCreator: false,
    providers: {
      voice: {
        providedBy: {
          kind: "platform",
          username: null,
        },
        transportProvider: "livekit",
        transportSource: "system",
        transportCredentialMask: null,
        transportReady: true,
        transcriptionEnabled: true,
        transcriptionProvider: "deepgram",
        transcriptionSource: "system",
        transcriptionCredentialMask: null,
        transcriptionReady: true,
      },
      analysis: {
        providedBy: {
          kind: "platform",
          username: null,
        },
        provider: "mock",
        source: "builtin",
        credentialMask: null,
        model: null,
        ready: true,
        profiles: {
          realtime: "default_cn",
          summary: "default_cn",
        },
      },
    },
  });
  const [connectionState, setConnectionState] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [micEnabled, setMicEnabled] = useState(false);
  const [participantId, setParticipantId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [roomError, setRoomError] = useState("");
  const [sendingText, setSendingText] = useState(false);
  const [endingRoom, setEndingRoom] = useState(false);
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionState>("idle");
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  const markTranscriptionReady = useCallback(() => {
    setTranscriptionState((current) => {
      if (current === "disabled" || current === "ready") {
        return current;
      }
      return "ready";
    });
  }, []);

  const upsertMessages = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) {
      return;
    }
    setMessages((current) => {
      const merged = mergeMessages(current, incoming);
      const latest = merged[merged.length - 1];
      latestMessageCreatedAtRef.current = latest ? latest.createdAt : null;
      return merged;
    });
  }, []);

  const disconnectRoom = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;

    if (audioContainerRef.current) {
      audioContainerRef.current.innerHTML = "";
    }

    setConnectionState("disconnected");
    setMicEnabled(false);
    setParticipantId("");
    setTranscriptionState("idle");
    connectStartedAtRef.current = null;
  }, []);

  const fetchRoomMeta = useCallback(async () => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/meta`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as RoomMetaResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? t("加载房间元数据失败", "Failed to load room metadata"));
    }

    setRoomMeta({
      status: payload.room.status,
      endedAt: payload.room.endedAt,
      isCreator: payload.room.isCreator,
      providers: payload.providers,
    });
  }, [roomId, t]);

  const fetchMessages = useCallback(
    async (since?: string | null) => {
      const endpoint = new URL(
        `/api/rooms/${encodeURIComponent(roomId)}/messages`,
        window.location.origin,
      );
      if (since) {
        endpoint.searchParams.set("since", since);
      }

      const response = await fetch(endpoint.toString(), { cache: "no-store" });
      const payload = (await response.json()) as MessagesResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? t("获取消息失败", "Failed to fetch messages"));
      }

      upsertMessages(payload.messages);
    },
    [roomId, t, upsertMessages],
  );

  const connectRoom = useCallback(async (options?: { enableMicrophone?: boolean }) => {
    const enableMicrophone = options?.enableMicrophone ?? false;

    if (connectionState !== "disconnected" || roomMeta.status === "ENDED") {
      return;
    }

    setRoomError("");
    setConnectionState("connecting");
    setTranscriptionState(enableMicrophone ? "starting" : "idle");
    connectStartedAtRef.current = Date.now();

    try {
      const tokenRes = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          connectionMode: enableMicrophone ? "voice" : "data",
        }),
      });
      const tokenPayload = (await tokenRes.json()) as TokenResponse;
      if (!tokenRes.ok) {
        throw new Error(tokenPayload.error ?? t("获取 LiveKit Token 失败", "Failed to fetch LiveKit token"));
      }

      setRoomMeta((current) => ({
        ...current,
        providers: tokenPayload.providers,
      }));

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio || !audioContainerRef.current) {
          return;
        }

        const element = track.attach();
        element.autoplay = true;
        audioContainerRef.current.appendChild(element);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) {
          return;
        }
        track.detach().forEach((element) => element.remove());
      });

      room.on(RoomEvent.Disconnected, () => {
        void fetchRoomMeta().catch(() => undefined);
        disconnectRoom();
      });
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (participant.kind === ParticipantKind.AGENT) {
          markTranscriptionReady();
        }
      });
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== LIVEKIT_CHAT_MESSAGE_TOPIC) {
          return;
        }

        const event = decodeLivekitChatMessageEvent(payload);
        if (!event || event.roomId !== roomId) {
          return;
        }

        upsertMessages([event.message]);
        if (event.message.type === "transcript") {
          markTranscriptionReady();
        }
      });

      await room.connect(tokenPayload.livekitUrl, tokenPayload.token);
      await room.localParticipant.setCameraEnabled(false);
      await room.localParticipant.setMicrophoneEnabled(enableMicrophone);

      if (enableMicrophone) {
        if (!tokenPayload.transcriberEnabled) {
          setTranscriptionState("disabled");
        } else if (
          [...room.remoteParticipants.values()].some(
            (participant) => participant.kind === ParticipantKind.AGENT,
          )
        ) {
          markTranscriptionReady();
        }
      } else {
        setTranscriptionState("idle");
      }

      roomRef.current = room;
      setParticipantId(tokenPayload.identity);
      setMicEnabled(enableMicrophone);
      setConnectionState("connected");
      void fetchMessages(latestMessageCreatedAtRef.current).catch(() => undefined);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : t("连接房间失败", "Failed to connect room"));
      disconnectRoom();
    }
  }, [
    connectionState,
    disconnectRoom,
    fetchMessages,
    fetchRoomMeta,
    markTranscriptionReady,
    roomId,
    roomMeta.status,
    t,
    upsertMessages,
  ]);

  const ensureVoiceRuntime = useCallback(async () => {
    const tokenRes = await fetch("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId,
        connectionMode: "voice",
      }),
    });
    const tokenPayload = (await tokenRes.json()) as TokenResponse;
    if (!tokenRes.ok) {
      throw new Error(
        tokenPayload.error ?? t("启动语音通道失败", "Failed to prepare voice runtime"),
      );
    }

    setRoomMeta((current) => ({
      ...current,
      providers: tokenPayload.providers,
    }));

    if (!tokenPayload.transcriberEnabled) {
      setTranscriptionState("disabled");
      return;
    }

    setTranscriptionState((current) => (current === "ready" ? current : "starting"));
  }, [roomId, t]);

  const toggleMic = useCallback(async () => {
    if (!roomRef.current || connectionState !== "connected") {
      return;
    }

    const nextMicState = !micEnabled;
    try {
      if (nextMicState) {
        await ensureVoiceRuntime();
      }

      await roomRef.current.localParticipant.setMicrophoneEnabled(nextMicState);
      setMicEnabled(nextMicState);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : t("切换麦克风失败", "Failed to toggle microphone"));
    }
  }, [connectionState, ensureVoiceRuntime, micEnabled, t]);

  async function endConversation() {
    if (!roomMeta.isCreator || roomMeta.status === "ENDED") {
      return;
    }

    setEndingRoom(true);
    setRoomError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/end`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        room?: { status: "ACTIVE" | "ENDED"; endedAt: string | null };
        error?: string;
      };
      if (!response.ok || !payload.room) {
        throw new Error(payload.error ?? t("结束房间失败", "Failed to end room"));
      }

      setRoomMeta((current) => ({
        ...current,
        status: payload.room!.status,
        endedAt: payload.room!.endedAt,
      }));
      disconnectRoom();
      void fetchMessages(latestMessageCreatedAtRef.current).catch(() => undefined);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : t("结束房间失败", "Failed to end room"));
    } finally {
      setEndingRoom(false);
    }
  }

  async function submitTextMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (roomMeta.status === "ENDED") {
      return;
    }

    const content = chatInput.trim();
    if (!content) {
      return;
    }

    setSendingText(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId,
          content,
        }),
      });

      const payload = (await response.json()) as { message?: ChatMessage; error?: string };
      if (!response.ok || !payload.message) {
        throw new Error(payload.error ?? t("发送消息失败", "Failed to send message"));
      }

      setChatInput("");
      upsertMessages([payload.message]);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : t("发送消息失败", "Failed to send message"));
    } finally {
      setSendingText(false);
    }
  }

  function handleChatInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (sendingText || roomMeta.status === "ENDED") {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  useEffect(() => {
    autoConnectAttemptedRef.current = false;
    latestMessageCreatedAtRef.current = null;
    setMessages([]);
    setRoomError("");
    void Promise.all([fetchRoomMeta(), fetchMessages(null)]).catch((error) => {
      setRoomError(error instanceof Error ? error.message : t("加载房间数据失败", "Failed to load room data"));
    });
  }, [fetchMessages, fetchRoomMeta, t]);

  useEffect(() => {
    if (roomMeta.status === "ENDED" && connectionState !== "disconnected") {
      disconnectRoom();
    }
  }, [connectionState, disconnectRoom, roomMeta.status]);

  useEffect(() => {
    if (autoConnectAttemptedRef.current) {
      return;
    }
    if (roomMeta.status === "ENDED") {
      return;
    }
    if (connectionState !== "disconnected") {
      return;
    }

    autoConnectAttemptedRef.current = true;
    void connectRoom({ enableMicrophone: false });
  }, [connectRoom, connectionState, roomMeta.status]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const input = chatInputRef.current;
    if (!input) {
      return;
    }

    const maxHeight = 168;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [chatInput]);

  useEffect(() => {
    if (connectionState !== "connected" || transcriptionState !== "starting") {
      return;
    }

    const connectStartedAt = connectStartedAtRef.current;
    if (connectStartedAt === null) {
      return;
    }

    const hasTranscriptAfterConnect = messages.some((message) => {
      if (message.type !== "transcript") {
        return false;
      }

      const createdAtMs = new Date(message.createdAt).getTime();
      if (Number.isNaN(createdAtMs)) {
        return false;
      }

      return createdAtMs >= connectStartedAt;
    });

    if (hasTranscriptAfterConnect) {
      markTranscriptionReady();
    }
  }, [connectionState, markTranscriptionReady, messages, transcriptionState]);

  useEffect(() => {
    return () => {
      disconnectRoom();
    };
  }, [disconnectRoom]);

  useEffect(() => {
    if (warmupRequestedRef.current) {
      return;
    }
    if (roomMeta.status === "ENDED") {
      return;
    }

    warmupRequestedRef.current = true;
    const timer = window.setTimeout(() => {
      void fetch(`/api/rooms/${encodeURIComponent(roomId)}/warmup`, {
        method: "POST",
      }).catch(() => undefined);
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [roomId, roomMeta.status]);

  const isEnded = roomMeta.status === "ENDED";

  return (
    <main className="room-page">
      <section className="room-shell room-shell-chat">
        <header className="room-header" style={{ paddingBottom: '16px' }}>
          <div className="room-header-title">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{roomId}</h1>
              <span className={`room-status ${connectionState}`}>
                {connectionState === "connected"
                  ? micEnabled
                    ? t("通话中", "In Call")
                    : t("已连接", "Connected")
                  : connectionState === "connecting"
                    ? t("连接中", "Connecting")
                    : t("未开始", "Not Started")}
              </span>
              <span className={`room-status transcription-status ${transcriptionState}`}>
                {transcriptionState === "ready"
                  ? t("转录中", "Transcribing")
                  : transcriptionState === "starting"
                    ? t("启动中", "Starting")
                    : transcriptionState === "disabled"
                      ? t("未启用", "Disabled")
                      : t("未转录", "Not Transcribing")}
              </span>
            </div>
            <div className="room-meta-row">
              <span>@{username}</span>
              {isEnded && (
                <>
                  <span style={{ color: 'var(--line-strong)' }}>|</span>
                  <span>
                    {t("已结束", "Ended")} ({formatDate(roomMeta.endedAt, language)})
                  </span>
                </>
              )}
              <span style={{ color: 'var(--line-strong)' }}>|</span>
              <div className="provider-tooltip">
                <div className="room-status provider-chip" tabIndex={0}>
                  {t("语音与转录提供者", "Voice Provider")}: {getVoiceProviderLabel(roomMeta.providers.voice, language)}
                </div>
                <div className="provider-popover" role="tooltip">
                  <div className="provider-popover-title">
                    {t("语音与转录", "Voice & Transcription")}
                  </div>
                  {getVoiceProviderDetails(roomMeta.providers.voice, language).map((item) => (
                    <div key={`voice-${item.label}`} className="provider-popover-row">
                      <span className="provider-popover-label">{item.label}</span>
                      <strong className="provider-popover-value">{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <div className="provider-tooltip">
                <div className="room-status provider-chip" tabIndex={0}>
                  {t("分析模块提供者", "Analysis Provider")}: {getAnalysisProviderLabel(roomMeta.providers.analysis, language)}
                </div>
                <div className="provider-popover" role="tooltip">
                  <div className="provider-popover-title">
                    {t("分析模块", "Analysis")}
                  </div>
                  {getAnalysisProviderDetails(roomMeta.providers.analysis, language).map((item) => (
                    <div key={`analysis-${item.label}`} className="provider-popover-row">
                      <span className="provider-popover-label">{item.label}</span>
                      <strong className="provider-popover-value">{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="room-actions">
            <Link className="text-link-button" style={{ height: '40px' }} href="/">
              {t("返回", "Back")}
            </Link>
            {roomMeta.isCreator ? (
              <button type="button" className="ghost-btn" style={{ height: '40px', background: 'transparent', border: '1px solid var(--error)', color: 'var(--error)' }} onClick={() => void endConversation()} disabled={endingRoom || isEnded}>
                {endingRoom
                  ? t("结束中...", "Ending...")
                  : isEnded
                    ? t("已结束", "Ended")
                    : t("结束对话", "End Room")}
              </button>
            ) : null}
          </div>
        </header>

        {roomError ? <p className="form-error room-error" style={{ margin: '0 0 16px' }}>{roomError}</p> : null}

        <section className="chat-panel">
          <div className="chat-scroll">
            {messages.length === 0 ? (
              <p className="empty-chat">{t("暂无历史消息。", "No message history yet.")}</p>
            ) : (
              messages.map((message) => {
                const announcement = message.type === "analysis" || message.type === "summary";
                const own = announcement ? false : isOwnMessage(message, participantId, username);
                return (
                  <div
                    key={message.id}
                    className={`message-row ${announcement ? "announcement" : own ? "self" : "other"}`}
                  >
                    <article
                      className={`bubble ${message.type} ${announcement ? "announcement" : own ? "self" : "other"}`}
                    >
                      <header className="bubble-meta">
                        <strong>
                          {announcement ? t("AI 分析", "AI Analysis") : own ? t("我", "Me") : message.senderName}
                        </strong>
                        <span className={`bubble-source ${message.type}`}>
                          {message.type === "transcript"
                            ? t("语音转录", "Transcript")
                            : message.type === "text"
                              ? t("文字消息", "Text")
                              : message.type === "analysis"
                                ? t("实时分析", "Realtime Analysis")
                                : t("最终总结", "Final Summary")}
                        </span>
                        <time dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time>
                      </header>
                      <p>{message.content}</p>
                    </article>
                  </div>
                );
              })
            )}
            <div ref={scrollAnchorRef} />
          </div>
        </section>

        <form className="chat-form room-chat-form" onSubmit={submitTextMessage}>
          <textarea
            ref={chatInputRef}
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={handleChatInputKeyDown}
            placeholder={
              isEnded
                ? t("房间已结束，仅可查看历史记录", "This room has ended and is now read-only")
                : t("输入消息...", "Type a message...")
            }
            disabled={isEnded}
            rows={1}
          />
          <button type="submit" className="primary-btn" disabled={sendingText || isEnded}>
            {sendingText ? t("发送中", "Sending") : t("发送", "Send")}
          </button>
          
          {connectionState === "connected" ? (
            <>
              <button type="button" onClick={toggleMic} disabled={isEnded} className={micEnabled ? "primary-btn" : "ghost-btn"}>
                {micEnabled ? t("静音", "Mute") : t("开麦", "Unmute")}
              </button>
              <button type="button" className="ghost-btn" onClick={disconnectRoom}>
                {t("挂断语音", "Hang Up")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void connectRoom({ enableMicrophone: true })}
              disabled={connectionState === "connecting" || isEnded}
            >
              {connectionState === "connecting"
                ? t("连接中...", "Connecting...")
                : t("开启语音", "Start Voice")}
            </button>
          )}
        </form>

        <div ref={audioContainerRef} className="audio-container" />
      </section>
    </main>
  );
}

