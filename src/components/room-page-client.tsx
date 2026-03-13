"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Room, RoomEvent, Track } from "livekit-client";

import { ChatMessage } from "@/lib/chat-types";
import { decodeLivekitChatMessageEvent, LIVEKIT_CHAT_MESSAGE_TOPIC } from "@/lib/livekit-chat-event";
import { getRoomDisplayName, getRoomNameFromAnalysisContent } from "@/lib/room-name";
import { getRoomSpeakerDisplayName, type RoomSpeakerMode } from "@/lib/room-speaker";
import { useUiLanguage } from "@/lib/use-ui-language";
import { toDateLocale, type UiLanguage } from "@/lib/ui-language";

type ProviderOwner = {
  kind: "platform" | "user" | "builtin" | "unavailable";
  username: string | null;
};

type VoiceProviderState = {
  providedBy: ProviderOwner;
  ready: boolean;
  error: string | null;
  transcriberEnabled: boolean;
  transport: {
    provider: string;
    source: "user" | "system" | "unavailable";
    credentialMask: string | null;
    ready: boolean;
  };
  transcription: {
    provider: string | null;
    source: "user" | "system" | "unavailable";
    credentialMask: string | null;
    ready: boolean;
  };
};

type AnalysisProviderState = {
  providedBy: ProviderOwner;
  provider: string;
  source: "user" | "system" | "unavailable" | "builtin";
  credentialMask: string | null;
  model: string | null;
  ready: boolean;
  error: string | null;
  profiles: {
    realtime: string;
    summary: string;
  };
};

type TokenResponse = {
  token: string;
  livekitUrl: string;
  identity: string;
  displayName: string;
  transcriberEnabled: boolean;
  providers: {
    voice: VoiceProviderState;
    analysis: AnalysisProviderState;
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
    roomName: string | null;
    status: "ACTIVE" | "ENDED";
    endedAt: string | null;
    isCreator: boolean;
    ownerPresence: {
      active: boolean;
      lastSeenAt: string | null;
      timeoutMs: number;
    };
  };
  providers: {
    voice: VoiceProviderState;
    analysis: AnalysisProviderState;
  };
  features: {
    speakerSwitchEnabled: boolean;
  };
  error?: string;
};

type RoomPageClientProps = {
  roomId: string;
  initialRoomName: string | null;
  username: string;
};

type TranscriptionState = "idle" | "starting" | "ready" | "disabled";

type RoomMetaState = {
  roomName: string | null;
  status: "ACTIVE" | "ENDED";
  endedAt: string | null;
  isCreator: boolean;
  ownerPresence: {
    active: boolean;
    lastSeenAt: string | null;
    timeoutMs: number;
  };
  providers: {
    voice: VoiceProviderState;
    analysis: AnalysisProviderState;
  };
  features: {
    speakerSwitchEnabled: boolean;
  };
};
type VoiceTrackParticipant = {
  isAgent: boolean;
  getTrackPublication(source: Track.Source): { isMuted: boolean } | undefined;
};

const ROOM_CONNECTION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const ROOM_META_POLL_INTERVAL_MS = 5 * 1000;

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

function isOwnMessage(message: ChatMessage, username: string) {
  if (message.type === "analysis" || message.type === "summary") {
    return false;
  }

  return message.senderName === username;
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
  owner: ProviderOwner,
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
  voice: VoiceProviderState,
  language: UiLanguage,
) {
  const details = [
    {
      label: language === "zh" ? "语音通道" : "Voice transport",
      value: formatProviderName(voice.transport.provider, language),
    },
    {
      label: language === "zh" ? "转录引擎" : "Transcription",
      value: voice.transcriberEnabled
        ? formatProviderName(voice.transcription.provider ?? "", language)
        : language === "zh"
          ? "已关闭"
          : "Disabled",
    },
    {
      label: language === "zh" ? "语音来源" : "Transport source",
      value: formatProviderValue(voice.transport.source, language),
    },
    {
      label: language === "zh" ? "转录来源" : "Transcription source",
      value: voice.transcriberEnabled
        ? formatProviderValue(voice.transcription.source, language)
        : language === "zh"
          ? "已关闭"
          : "Disabled",
    },
  ];

  if (!voice.ready && voice.error) {
    details.push({
      label: language === "zh" ? "错误" : "Error",
      value: voice.error,
    });
  }

  return details;
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

  if (!analysis.ready && analysis.error) {
    details.push({
      label: language === "zh" ? "错误" : "Error",
      value: analysis.error,
    });
  }

  return details;
}

function getIdleTranscriptionState(voice: VoiceProviderState): TranscriptionState {
  return voice.transcriberEnabled && voice.transcription.ready ? "idle" : "disabled";
}

function getOwnerOfflineError(language: UiLanguage) {
  return language === "zh"
    ? "房主当前不在房间，连接已断开。"
    : "Room owner is offline. The live room connection has been disconnected.";
}

function hasPublishedMicrophoneTrack(participant: VoiceTrackParticipant) {
  if (participant.isAgent) {
    return false;
  }

  const publication = participant.getTrackPublication(Track.Source.Microphone);
  return Boolean(publication && !publication.isMuted);
}

function hasConnectedTranscriberParticipant(room: Room) {
  return [...room.remoteParticipants.values()].some((participant) => participant.isAgent);
}

function findLatestRoomNameFromMessages(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const roomName = getRoomNameFromAnalysisContent(messages[index].content);
    if (roomName) {
      return roomName;
    }
  }

  return null;
}

export default function RoomPageClient({ roomId, initialRoomName, username }: RoomPageClientProps) {
  const { language } = useUiLanguage();
  const isZh = language === "zh";
  const t = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);

  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const warmupRequestedRef = useRef(false);
  const latestMessageCreatedAtRef = useRef<string | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);

  const [roomMeta, setRoomMeta] = useState<RoomMetaState>({
    roomName: initialRoomName,
    status: "ACTIVE",
    endedAt: null,
    isCreator: false,
    ownerPresence: {
      active: false,
      lastSeenAt: null,
      timeoutMs: 0,
    },
    providers: {
      voice: {
        providedBy: {
          kind: "platform",
          username: null,
        },
        ready: true,
        error: null,
        transcriberEnabled: true,
        transport: {
          provider: "livekit",
          source: "system",
          credentialMask: null,
          ready: true,
        },
        transcription: {
          provider: "deepgram",
          source: "system",
          credentialMask: null,
          ready: true,
        },
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
        error: null,
        profiles: {
          realtime: "default_cn",
          summary: "default_cn",
        },
      },
    },
    features: {
      speakerSwitchEnabled: false,
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
  const [speakerMode, setSpeakerMode] = useState<RoomSpeakerMode>("self");
  const [speakerSwitchPending, setSpeakerSwitchPending] = useState(false);
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionState>("idle");
  const [hasAutoConnectAttempted, setHasAutoConnectAttempted] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceProviderRef = useRef(roomMeta.providers.voice);
  const micEnabledRef = useRef(false);
  const participantIdentityRef = useRef("");
  const speakerModeRef = useRef<RoomSpeakerMode>("self");
  const pendingVoiceRestartAfterSpeakerSwitchRef = useRef(false);
  const voiceCallStartingRef = useRef(false);
  const transcriptionRuntimeReadyRef = useRef(false);
  const previousOwnerActiveRef = useRef(false);

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

  const releaseVoiceRuntimeIfIdle = useCallback(
    async (options?: { keepalive?: boolean }) => {
      const participantIdentity = participantIdentityRef.current.trim();
      if (!participantIdentity) {
        return;
      }

      try {
        await fetch(`/api/rooms/${encodeURIComponent(roomId)}/voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantIdentity,
          }),
          keepalive: options?.keepalive,
        });
      } catch {
        // Ignore cleanup failures; retry happens on next voice lifecycle transition.
      }
    },
    [roomId],
  );

  const clearConnectionIdleTimer = useCallback(() => {
    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const disableLocalMicrophone = useCallback(async (room?: Room | null) => {
    const targetRoom = room ?? roomRef.current;
    if (!targetRoom) {
      return;
    }

    micEnabledRef.current = false;
    setMicEnabled(false);

    await targetRoom.localParticipant.setMicrophoneEnabled(false);

    const microphoneTracks = [...targetRoom.localParticipant.audioTrackPublications.values()]
      .filter((publication) => publication.source === Track.Source.Microphone)
      .map((publication) => publication.track)
      .filter((track): track is NonNullable<typeof track> => Boolean(track));

    await Promise.allSettled(
      microphoneTracks.map(async (track) => {
        await targetRoom.localParticipant.unpublishTrack(track, true).catch(() => undefined);
        track.stop();
      }),
    );
  }, []);

  const syncVoiceSessionState = useCallback((room?: Room | null) => {
    const targetRoom = room ?? roomRef.current;
    const voiceProvider = voiceProviderRef.current;

    if (!targetRoom) {
      setMicEnabled(false);
      setTranscriptionState(getIdleTranscriptionState(voiceProvider));
      return;
    }

    const localVoiceActive = hasPublishedMicrophoneTrack(targetRoom.localParticipant);
    const remoteVoiceActive = [...targetRoom.remoteParticipants.values()].some((participant) =>
      hasPublishedMicrophoneTrack(participant),
    );
    const hasActiveVoiceSession = localVoiceActive || remoteVoiceActive;
    const transcriberConnected = hasConnectedTranscriberParticipant(targetRoom);
    const transcriptionRuntimeReady =
      transcriptionRuntimeReadyRef.current || transcriberConnected;

    if (transcriberConnected) {
      transcriptionRuntimeReadyRef.current = true;
    }

    setMicEnabled(localVoiceActive);
    setTranscriptionState(
      !voiceProvider.transcriberEnabled || !voiceProvider.transcription.ready
        ? "disabled"
        : voiceCallStartingRef.current
          ? hasActiveVoiceSession && transcriptionRuntimeReady
            ? "ready"
            : "starting"
          : !hasActiveVoiceSession
            ? "idle"
            : transcriptionRuntimeReady
              ? "ready"
              : "starting",
    );
  }, []);

  const disconnectRoom = useCallback(
    (options?: { updateState?: boolean }) => {
      const updateState = options?.updateState ?? true;

      clearConnectionIdleTimer();
      const activeRoom = roomRef.current;
      roomRef.current = null;
      voiceCallStartingRef.current = false;
      transcriptionRuntimeReadyRef.current = false;
      void disableLocalMicrophone(activeRoom).catch(() => undefined);
      activeRoom?.disconnect();

      if (audioContainerRef.current) {
        audioContainerRef.current.innerHTML = "";
      }

      if (!updateState) {
        return;
      }

      setConnectionState("disconnected");
      setMicEnabled(false);
      setParticipantId("");
      setTranscriptionState(getIdleTranscriptionState(voiceProviderRef.current));
    },
    [clearConnectionIdleTimer, disableLocalMicrophone],
  );

  const armConnectionIdleTimer = useCallback(() => {
    clearConnectionIdleTimer();

    if (!roomRef.current || roomMeta.status === "ENDED") {
      return;
    }

    inactivityTimerRef.current = window.setTimeout(() => {
      setRoomError(
        t(
          "3分钟未发言，房间连接已断开，请重新连接。",
          "Disconnected after 3 minutes of inactivity. Reconnect to continue.",
        ),
      );
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle();
      }
      disconnectRoom();
    }, ROOM_CONNECTION_IDLE_TIMEOUT_MS);
  }, [clearConnectionIdleTimer, disconnectRoom, releaseVoiceRuntimeIfIdle, roomMeta.status, t]);

  const fetchRoomMeta = useCallback(async () => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/meta`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as RoomMetaResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? t("加载房间元数据失败", "Failed to load room metadata"));
    }

    setRoomMeta({
      roomName: payload.room.roomName,
      status: payload.room.status,
      endedAt: payload.room.endedAt,
      isCreator: payload.room.isCreator,
      ownerPresence: payload.room.ownerPresence,
      providers: payload.providers,
      features: payload.features,
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

  const connectRoom = useCallback(async () => {
    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (
      roomRef.current ||
      connectionState !== "disconnected" ||
      roomMeta.status === "ENDED" ||
      !ownerActive
    ) {
      return;
    }

    setRoomError("");
    setConnectionState("connecting");
    let room: Room | null = null;

    try {
      const tokenRes = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          connectionMode: "data",
          speakerMode: speakerModeRef.current,
        }),
      });
      const tokenPayload = (await tokenRes.json()) as TokenResponse;
      if (!tokenRes.ok) {
        throw new Error(tokenPayload.error ?? t("获取 LiveKit Token 失败", "Failed to fetch LiveKit token"));
      }

      voiceProviderRef.current = tokenPayload.providers.voice;
      setRoomMeta((current) => ({
        ...current,
        providers: tokenPayload.providers,
      }));

      room = new Room({
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
        if (roomRef.current !== room) {
          return;
        }

        if (micEnabledRef.current) {
          void releaseVoiceRuntimeIfIdle();
        }
        void fetchRoomMeta().catch(() => undefined);
        disconnectRoom();
      });
      room.on(RoomEvent.ParticipantConnected, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.TrackPublished, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.TrackUnpublished, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.TrackMuted, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.TrackUnmuted, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.LocalTrackPublished, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.LocalTrackUnpublished, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (roomRef.current !== room) {
          return;
        }

        if (speakers.some((participant) => participant.isLocal)) {
          armConnectionIdleTimer();
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
        if (event.message.type === "transcript" && roomRef.current === room) {
          transcriptionRuntimeReadyRef.current = true;
          syncVoiceSessionState(room);
        }
      });

      await room.connect(tokenPayload.livekitUrl, tokenPayload.token);
      await room.localParticipant.setCameraEnabled(false);
      await room.localParticipant.setMicrophoneEnabled(false);

      roomRef.current = room;
      setParticipantId(tokenPayload.identity);
      setConnectionState("connected");
      syncVoiceSessionState(room);
      armConnectionIdleTimer();
      void fetchMessages(latestMessageCreatedAtRef.current).catch(() => undefined);
    } catch (error) {
      room?.disconnect();
      pendingVoiceRestartAfterSpeakerSwitchRef.current = false;
      setSpeakerSwitchPending(false);
      setRoomError(error instanceof Error ? error.message : t("连接房间失败", "Failed to connect room"));
      disconnectRoom();
    }
  }, [
    armConnectionIdleTimer,
    connectionState,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    disconnectRoom,
    fetchMessages,
    fetchRoomMeta,
    releaseVoiceRuntimeIfIdle,
    roomId,
    roomMeta.status,
    syncVoiceSessionState,
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
        speakerMode: speakerModeRef.current,
      }),
    });
    const tokenPayload = (await tokenRes.json()) as TokenResponse;
    if (!tokenRes.ok) {
      throw new Error(
        tokenPayload.error ?? t("启动语音通道失败", "Failed to prepare voice runtime"),
      );
    }

    voiceProviderRef.current = tokenPayload.providers.voice;
    setRoomMeta((current) => ({
      ...current,
      providers: tokenPayload.providers,
    }));

    if (!tokenPayload.transcriberEnabled) {
      transcriptionRuntimeReadyRef.current = false;
      setTranscriptionState("disabled");
      return {
        transcriberEnabled: false,
      };
    }

    transcriptionRuntimeReadyRef.current = roomRef.current
      ? hasConnectedTranscriberParticipant(roomRef.current)
      : false;
    setTranscriptionState("starting");
    return {
      transcriberEnabled: true,
    };
  }, [roomId, t]);

  const startVoiceCall = useCallback(async () => {
    const activeRoom = roomRef.current;
    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (
      !activeRoom ||
      connectionState !== "connected" ||
      roomMeta.status === "ENDED" ||
      !ownerActive ||
      micEnabled ||
      transcriptionState === "starting"
    ) {
      return;
    }

    setRoomError("");
    setTranscriptionState("starting");
    voiceCallStartingRef.current = true;
    transcriptionRuntimeReadyRef.current = false;
    try {
      await ensureVoiceRuntime();

      await activeRoom.localParticipant.setMicrophoneEnabled(true);
      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
        armConnectionIdleTimer();
      }
    } catch (error) {
      setTranscriptionState(getIdleTranscriptionState(voiceProviderRef.current));
      setRoomError(error instanceof Error ? error.message : t("开启通话失败", "Failed to start call"));
    } finally {
      voiceCallStartingRef.current = false;
    }
  }, [
    armConnectionIdleTimer,
    connectionState,
    ensureVoiceRuntime,
    micEnabled,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
    transcriptionState,
    syncVoiceSessionState,
    t,
  ]);

  const leaveVoiceCall = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom || connectionState !== "connected" || !micEnabled) {
      return;
    }

    setRoomError("");
    try {
      voiceCallStartingRef.current = false;
      transcriptionRuntimeReadyRef.current = false;
      await disableLocalMicrophone(activeRoom);
      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
        armConnectionIdleTimer();
      }
      await releaseVoiceRuntimeIfIdle();
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : t("退出通话失败", "Failed to leave call"));
    }
  }, [
    armConnectionIdleTimer,
    connectionState,
    disableLocalMicrophone,
    micEnabled,
    releaseVoiceRuntimeIfIdle,
    syncVoiceSessionState,
    t,
  ]);

  async function switchSpeakerMode() {
    if (
      !roomMeta.features.speakerSwitchEnabled ||
      speakerSwitchPending ||
      roomMeta.status === "ENDED"
    ) {
      return;
    }

    const nextSpeakerMode: RoomSpeakerMode = speakerModeRef.current === "self" ? "bot" : "self";
    const shouldReconnect = Boolean(roomRef.current) || connectionState !== "disconnected";
    const shouldResumeVoice = micEnabledRef.current;

    setRoomError("");
    setSpeakerMode(nextSpeakerMode);

    if (!shouldReconnect) {
      return;
    }

    setSpeakerSwitchPending(true);
    pendingVoiceRestartAfterSpeakerSwitchRef.current = shouldResumeVoice;

    if (shouldResumeVoice && roomRef.current) {
      try {
        voiceCallStartingRef.current = false;
        transcriptionRuntimeReadyRef.current = false;
        await disableLocalMicrophone(roomRef.current);
        await releaseVoiceRuntimeIfIdle();
      } catch {
        // Best-effort cleanup before reconnecting under the other speaker identity.
      }
    }

    setHasAutoConnectAttempted(false);
    disconnectRoom();
  }

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
      voiceCallStartingRef.current = false;
      transcriptionRuntimeReadyRef.current = false;
      await disableLocalMicrophone(roomRef.current).catch(() => undefined);
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
    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (roomMeta.status === "ENDED" || !ownerActive) {
      if (!ownerActive) {
        setRoomError(getOwnerOfflineError(language));
      }
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
          content,
          speakerMode: speakerModeRef.current,
        }),
      });

      const payload = (await response.json()) as { message?: ChatMessage; error?: string };
      if (!response.ok || !payload.message) {
        throw new Error(payload.error ?? t("发送消息失败", "Failed to send message"));
      }

      setChatInput("");
      upsertMessages([payload.message]);
      armConnectionIdleTimer();
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
    if (sendingText || roomMeta.status === "ENDED" || (!roomMeta.isCreator && !roomMeta.ownerPresence.active)) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  useEffect(() => {
    setHasAutoConnectAttempted(false);
    latestMessageCreatedAtRef.current = null;
    setMessages([]);
    setRoomError("");
    void Promise.all([fetchRoomMeta(), fetchMessages(null)]).catch((error) => {
      setRoomError(error instanceof Error ? error.message : t("加载房间数据失败", "Failed to load room data"));
    });
  }, [fetchMessages, fetchRoomMeta, t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchRoomMeta().catch(() => undefined);
    }, ROOM_META_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchRoomMeta]);

  useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);

  useEffect(() => {
    participantIdentityRef.current = participantId;
  }, [participantId]);

  useEffect(() => {
    speakerModeRef.current = speakerMode;
  }, [speakerMode]);

  useEffect(() => {
    voiceProviderRef.current = roomMeta.providers.voice;
    if (roomRef.current) {
      if (transcriptionState === "starting") {
        return;
      }
      syncVoiceSessionState(roomRef.current);
      return;
    }

    setTranscriptionState(getIdleTranscriptionState(roomMeta.providers.voice));
  }, [roomMeta.providers.voice, syncVoiceSessionState, transcriptionState]);

  useEffect(() => {
    if (roomMeta.status === "ENDED" && connectionState !== "disconnected") {
      disconnectRoom();
    }
  }, [connectionState, disconnectRoom, roomMeta.status]);

  useEffect(() => {
    if (!speakerSwitchPending || connectionState !== "connected") {
      return;
    }

    if (!pendingVoiceRestartAfterSpeakerSwitchRef.current) {
      setSpeakerSwitchPending(false);
      return;
    }

    pendingVoiceRestartAfterSpeakerSwitchRef.current = false;
    void startVoiceCall().finally(() => {
      setSpeakerSwitchPending(false);
    });
  }, [connectionState, speakerSwitchPending, startVoiceCall]);

  useEffect(() => {
    if (!speakerSwitchPending) {
      return;
    }

    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (roomMeta.status !== "ENDED" && ownerActive) {
      return;
    }

    pendingVoiceRestartAfterSpeakerSwitchRef.current = false;
    setSpeakerSwitchPending(false);
  }, [
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
    speakerSwitchPending,
  ]);

  useEffect(() => {
    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (ownerActive && !previousOwnerActiveRef.current) {
      setHasAutoConnectAttempted(false);
    }
    previousOwnerActiveRef.current = ownerActive;
  }, [roomMeta.isCreator, roomMeta.ownerPresence.active]);

  useEffect(() => {
    if (hasAutoConnectAttempted) {
      return;
    }
    if (roomMeta.status === "ENDED") {
      return;
    }
    if (!roomMeta.isCreator && !roomMeta.ownerPresence.active) {
      return;
    }
    if (connectionState !== "disconnected") {
      return;
    }

    setHasAutoConnectAttempted(true);
    void connectRoom();
  }, [
    connectRoom,
    connectionState,
    hasAutoConnectAttempted,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
  ]);

  useEffect(() => {
    if (roomMeta.status === "ENDED" || roomMeta.isCreator || roomMeta.ownerPresence.active) {
      return;
    }

    setRoomError(getOwnerOfflineError(language));
    if (connectionState !== "disconnected") {
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle();
      }
      disconnectRoom();
    }
  }, [
    connectionState,
    disconnectRoom,
    language,
    releaseVoiceRuntimeIfIdle,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
  ]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const inferredRoomName = findLatestRoomNameFromMessages(messages);
    if (!inferredRoomName) {
      return;
    }

    setRoomMeta((current) =>
      current.roomName === inferredRoomName
        ? current
        : {
            ...current,
            roomName: inferredRoomName,
          },
    );
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
    return () => {
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle();
      }
      voiceCallStartingRef.current = false;
      transcriptionRuntimeReadyRef.current = false;
      disconnectRoom({ updateState: false });
    };
  }, [disconnectRoom, releaseVoiceRuntimeIfIdle]);

  useEffect(() => {
    const handlePageHide = () => {
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle({ keepalive: true });
      }
      voiceCallStartingRef.current = false;
      transcriptionRuntimeReadyRef.current = false;
      disconnectRoom({ updateState: false });
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [disconnectRoom, releaseVoiceRuntimeIfIdle]);

  useEffect(() => {
    if (warmupRequestedRef.current) {
      return;
    }
    if (roomMeta.status === "ENDED") {
      return;
    }
    if (!roomMeta.isCreator && !roomMeta.ownerPresence.active) {
      return;
    }

    warmupRequestedRef.current = true;
    void fetch(`/api/rooms/${encodeURIComponent(roomId)}/warmup`, {
      method: "POST",
    }).catch(() => undefined);
  }, [roomId, roomMeta.isCreator, roomMeta.ownerPresence.active, roomMeta.status]);

  const isEnded = roomMeta.status === "ENDED";
  const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
  const roomInteractionBlocked = isEnded || !ownerActive;
  const isInitialConnectionPending =
    connectionState === "disconnected" && !hasAutoConnectAttempted && !roomInteractionBlocked;
  const roomConnectionStatusClass = isInitialConnectionPending ? "connecting" : connectionState;
  const roomDisplayName = getRoomDisplayName(roomMeta.roomName, roomId);
  const currentSpeakerName = getRoomSpeakerDisplayName(username, speakerMode);
  const nextSpeakerMode: RoomSpeakerMode = speakerMode === "self" ? "bot" : "self";
  const nextSpeakerName = getRoomSpeakerDisplayName(username, nextSpeakerMode);

  return (
    <main className="room-page">
      <section className="room-shell room-shell-chat">
        <header className="room-header" style={{ paddingBottom: '16px' }}>
          <div className="room-header-title">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{roomDisplayName}</h1>
              <span className={`room-status ${roomConnectionStatusClass}`}>
                {connectionState === "connected"
                  ? t("房间已连接", "Room Connected")
                  : connectionState === "connecting" || isInitialConnectionPending
                    ? t("连接房间中", "Connecting Room")
                    : t("房间未连接", "Room Disconnected")}
              </span>
              <span className={`room-status transcription-status ${transcriptionState}`}>
                {transcriptionState === "ready"
                  ? t("语音转录已开启", "Voice Transcription On")
                  : transcriptionState === "starting"
                    ? t("语音转录启动中", "Voice Transcription Starting")
                    : transcriptionState === "disabled"
                      ? t("语音转录不可用", "Voice Transcription Unavailable")
                      : t("语音转录未开始", "Voice Transcription Not Started")}
              </span>
            </div>
            {roomMeta.roomName ? (
              <p className="room-header-code">
                {t("房间代码", "Room code")}: {roomId}
              </p>
            ) : null}
            <div className="room-meta-row">
              <span>@{username}</span>
              {roomMeta.features.speakerSwitchEnabled ? (
                <>
                  <span style={{ color: 'var(--line-strong)' }}>|</span>
                  <span>
                    {t("当前说话方", "Current Speaker")}: {currentSpeakerName}
                  </span>
                </>
              ) : null}
              {isEnded && (
                <>
                  <span style={{ color: 'var(--line-strong)' }}>|</span>
                  <span>
                    {t("已结束", "Ended")} ({formatDate(roomMeta.endedAt, language)})
                  </span>
                </>
              )}
              {!isEnded && !ownerActive && (
                <>
                  <span style={{ color: 'var(--line-strong)' }}>|</span>
                  <span>{t("房主离线", "Owner Offline")}</span>
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
            {roomMeta.features.speakerSwitchEnabled ? (
              <button
                type="button"
                className="ghost-btn"
                style={{ height: '40px' }}
                onClick={() => void switchSpeakerMode()}
                disabled={isEnded || connectionState === "connecting" || speakerSwitchPending}
              >
                {speakerSwitchPending
                  ? t("切换中...", "Switching...")
                  : t(`切换到 ${nextSpeakerName}`, `Switch to ${nextSpeakerName}`)}
              </button>
            ) : null}
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
                const own = announcement ? false : isOwnMessage(message, username);
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
                : !ownerActive
                  ? t("房主离线，暂时无法发送消息", "Owner is offline, messages are temporarily unavailable")
                : t("输入消息...", "Type a message...")
            }
            disabled={roomInteractionBlocked}
            rows={1}
          />
          <button type="submit" className="primary-btn" disabled={sendingText || roomInteractionBlocked}>
            {sendingText ? t("发送中", "Sending") : t("发送", "Send")}
          </button>
          
          {connectionState === "connected" ? (
            <button
              type="button"
              className={micEnabled ? "primary-btn" : "ghost-btn"}
              onClick={() => void (micEnabled ? leaveVoiceCall() : startVoiceCall())}
              disabled={roomInteractionBlocked}
            >
              {micEnabled ? t("退出通话", "Leave Call") : t("开始通话", "Start Call")}
            </button>
          ) : hasAutoConnectAttempted && !isEnded && ownerActive ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void connectRoom()}
              disabled={connectionState === "connecting"}
            >
              {connectionState === "connecting"
                ? t("重连中...", "Reconnecting...")
                : t("重新连接", "Reconnect")}
            </button>
          ) : !isEnded ? (
            <button type="button" className="ghost-btn" disabled>
              {t("等待房主在线", "Waiting for Owner")}
            </button>
          ) : null}
        </form>

        <div ref={audioContainerRef} className="audio-container" />
      </section>
    </main>
  );
}

