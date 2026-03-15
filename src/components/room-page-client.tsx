"use client";

import { CSSProperties, FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Room, RoomEvent, Track } from "livekit-client";

import {
  type RealtimeAnalysisContent,
  type RealtimeAnalysisRoundScore,
  type RealtimeAnalysisSide,
} from "@/features/analysis/llm/realtime-analysis";
import { ChatMessage } from "@/lib/chat-types";
import { decodeLivekitChatMessageEvent, LIVEKIT_CHAT_MESSAGE_TOPIC } from "@/lib/livekit-chat-event";
import {
  decodeLivekitTranscriptionStatusEvent,
  LIVEKIT_TRANSCRIPTION_STATUS_TOPIC,
} from "@/lib/livekit-transcription-status-event";
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
    analysisEnabled: boolean;
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
  userId: string;
  username: string;
};

type TranscriptionState = "idle" | "starting" | "ready" | "disabled";

type RoomMetaState = {
  roomName: string | null;
  status: "ACTIVE" | "ENDED";
  analysisEnabled: boolean;
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
  getTrackPublication(source: Track.Source): { isMuted: boolean; trackSid?: string | null } | undefined;
};

type AnalysisPerspectiveLabels = {
  ownSourceLabel: RealtimeAnalysisSide | null;
  otherSourceLabel: RealtimeAnalysisSide | null;
};

type AnalysisMessageView = AnalysisPerspectiveLabels & {
  content: RealtimeAnalysisContent;
};

type AnalysisViewState = {
  messageViews: Map<string, AnalysisMessageView>;
  scores: {
    own: number;
    other: number;
  };
  overallInsights: {
    own: string;
    other: string;
  };
  suggestions: {
    own: string[];
    other: string[];
  };
};

const ROOM_CONNECTION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const ROOM_META_POLL_INTERVAL_MS = 5 * 1000;
const TRANSCRIBER_PARTICIPANT_TIMEOUT_MS = 12 * 1000;
const TRANSCRIPTION_ATTACHMENT_TIMEOUT_MS = 5 * 1000;
const ANALYSIS_SIDE_ORDER: RealtimeAnalysisSide[] = ["A", "B"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function isConversationMessage(message: ChatMessage) {
  return message.type === "text" || message.type === "transcript";
}

function resolveUserKeyFromParticipantId(participantId?: string | null) {
  const normalized = participantId?.trim();
  if (!normalized) {
    return null;
  }

  const match = /^user-(.+)$/.exec(normalized);
  const userId = match?.[1]?.trim();
  return userId ? `user:${userId}` : null;
}

function resolveConversationSpeakerKey(message: ChatMessage) {
  if (!isConversationMessage(message)) {
    return null;
  }

  const userKey = resolveUserKeyFromParticipantId(message.participantId);
  if (userKey) {
    return userKey;
  }

  const participantId = message.participantId?.trim();
  if (participantId) {
    return `participant:${participantId}`;
  }

  const senderName = message.senderName.trim().toLowerCase();
  if (senderName) {
    return `sender:${senderName}`;
  }

  return "sender:unknown";
}

function resolveConversationSpeakerLabel(index: number) {
  if (index >= 0 && index < 26) {
    return String.fromCharCode(65 + index);
  }

  return `P${index + 1}`;
}

function parseRealtimeAnalysisMessage(message: ChatMessage) {
  if (message.type !== "analysis") {
    return null;
  }

  try {
    const parsed = JSON.parse(message.content) as unknown;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed) || parsed.type !== "realtime-analysis") {
      return null;
    }

    return parsed as RealtimeAnalysisContent;
  } catch {
    return null;
  }
}

function deriveAnalysisPerspectiveLabels(
  assignments: Map<string, string>,
  currentUserId: string,
): AnalysisPerspectiveLabels {
  const assignedLabels = new Set(
    [...assignments.values()].filter(
      (label): label is RealtimeAnalysisSide => label === "A" || label === "B",
    ),
  );
  const trackedLabels = ANALYSIS_SIDE_ORDER.filter((label) => assignedLabels.has(label));
  const currentUserLabel = assignments.get(`user:${currentUserId}`);
  const ownSourceLabel =
    currentUserLabel === "A" || currentUserLabel === "B" ? currentUserLabel : null;

  if (ownSourceLabel) {
    return {
      ownSourceLabel,
      otherSourceLabel: trackedLabels.find((label) => label !== ownSourceLabel) ?? null,
    };
  }

  if (trackedLabels.length === 1) {
    return {
      ownSourceLabel: null,
      otherSourceLabel: trackedLabels[0],
    };
  }

  if (trackedLabels.length >= 2) {
    return {
      ownSourceLabel: "A",
      otherSourceLabel: "B",
    };
  }

  return {
    ownSourceLabel: null,
    otherSourceLabel: null,
  };
}

function getAnalysisInsight(
  content: RealtimeAnalysisContent,
  scope: keyof RealtimeAnalysisContent["insights"],
  label: RealtimeAnalysisSide | null,
) {
  if (!label) {
    return "";
  }

  const insights = isRecord(content.insights as unknown)
    ? (content.insights as Record<string, unknown>)
    : null;
  const scopedInsights = insights && isRecord(insights[scope]) ? insights[scope] : null;
  const value = scopedInsights?.[label];

  return typeof value === "string" ? value : "";
}

function getAnalysisSuggestions(
  content: RealtimeAnalysisContent,
  label: RealtimeAnalysisSide | null,
) {
  if (!label) {
    return [];
  }

  const suggestions = isRecord(content.suggestions as unknown)
    ? (content.suggestions as Record<string, unknown>)
    : null;
  const value = suggestions?.[label];

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getAnalysisRoundScore(
  content: RealtimeAnalysisContent,
  label: RealtimeAnalysisSide | null,
): RealtimeAnalysisRoundScore | null {
  if (!label) {
    return null;
  }

  const roundScores = isRecord(content.roundScores as unknown)
    ? (content.roundScores as Record<string, unknown>)
    : null;
  const value = roundScores?.[label];
  if (!isRecord(value)) {
    return null;
  }

  const rawDelta = value.delta;
  let delta = Number.NaN;
  if (typeof rawDelta === "number") {
    delta = rawDelta;
  } else if (typeof rawDelta === "string") {
    const normalizedDelta = rawDelta.trim();
    if (normalizedDelta) {
      delta = Number(normalizedDelta);
    }
  }
  const reason = typeof value.reason === "string" ? value.reason : "";

  if (!Number.isFinite(delta) && !reason) {
    return null;
  }

  return {
    delta: Number.isFinite(delta) ? delta : 0,
    reason,
  };
}

function buildAnalysisViewState(messages: ChatMessage[], currentUserId: string): AnalysisViewState {
  const assignments = new Map<string, string>();
  const messageViews = new Map<string, AnalysisMessageView>();
  let ownScore = 100;
  let otherScore = 100;
  let ownOverallInsight = "";
  let otherOverallInsight = "";
  let ownSuggestions: string[] = [];
  let otherSuggestions: string[] = [];

  for (const message of messages) {
    const speakerKey = resolveConversationSpeakerKey(message);
    if (speakerKey && !assignments.has(speakerKey)) {
      assignments.set(speakerKey, resolveConversationSpeakerLabel(assignments.size));
    }

    const content = parseRealtimeAnalysisMessage(message);
    if (!content) {
      continue;
    }

    const perspectiveLabels = deriveAnalysisPerspectiveLabels(assignments, currentUserId);
    messageViews.set(message.id, {
      ...perspectiveLabels,
      content,
    });

    const ownRoundScore = getAnalysisRoundScore(content, perspectiveLabels.ownSourceLabel);
    const otherRoundScore = getAnalysisRoundScore(content, perspectiveLabels.otherSourceLabel);
    if (ownRoundScore) {
      ownScore += ownRoundScore.delta;
    }
    if (otherRoundScore) {
      otherScore += otherRoundScore.delta;
    }

    const nextOwnOverallInsight = getAnalysisInsight(content, "overall", perspectiveLabels.ownSourceLabel);
    const nextOtherOverallInsight = getAnalysisInsight(content, "overall", perspectiveLabels.otherSourceLabel);
    if (nextOwnOverallInsight) {
      ownOverallInsight = nextOwnOverallInsight;
    }
    if (nextOtherOverallInsight) {
      otherOverallInsight = nextOtherOverallInsight;
    }

    const nextOwnSuggestions = getAnalysisSuggestions(content, perspectiveLabels.ownSourceLabel);
    const nextOtherSuggestions = getAnalysisSuggestions(content, perspectiveLabels.otherSourceLabel);
    if (nextOwnSuggestions.length > 0) {
      ownSuggestions = nextOwnSuggestions;
    }
    if (nextOtherSuggestions.length > 0) {
      otherSuggestions = nextOtherSuggestions;
    }
  }

  return {
    messageViews,
    scores: {
      own: ownScore,
      other: otherScore,
    },
    overallInsights: {
      own: ownOverallInsight,
      other: otherOverallInsight,
    },
    suggestions: {
      own: ownSuggestions,
      other: otherSuggestions,
    },
  };
}

function isOwnMessage(message: ChatMessage, userId: string, username: string) {
  if (message.type === "analysis" || message.type === "summary") {
    return false;
  }

  const speakerKey = resolveConversationSpeakerKey(message);
  if (speakerKey) {
    return speakerKey === `user:${userId}`;
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

function getPublishedMicrophoneTrackSid(participant: VoiceTrackParticipant) {
  if (participant.isAgent) {
    return null;
  }

  const publication = participant.getTrackPublication(Track.Source.Microphone);
  if (!publication || publication.isMuted) {
    return null;
  }

  return typeof publication.trackSid === "string" && publication.trackSid ? publication.trackSid : null;
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

export default function RoomPageClient({ roomId, initialRoomName, userId, username }: RoomPageClientProps) {
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
    analysisEnabled: true,
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
  const [analysisTogglePending, setAnalysisTogglePending] = useState(false);
  const [speakerMode, setSpeakerMode] = useState<RoomSpeakerMode>("self");
  const [speakerSwitchPending, setSpeakerSwitchPending] = useState(false);
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionState>("idle");
  const [voiceCallStarting, setVoiceCallStarting] = useState(false);
  const [hasAutoConnectAttempted, setHasAutoConnectAttempted] = useState(false);
  
  const [rawMessageId, setRawMessageId] = useState<string | null>(null);
  const [showEndRoomConfirm, setShowEndRoomConfirm] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const [hasConfirmedSwitchOnce, setHasConfirmedSwitchOnce] = useState(false);
  const [showMobileAnalysis, setShowMobileAnalysis] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeStatusTooltip, setActiveStatusTooltip] = useState<"connection" | "transcription" | null>(null);

  // 麦克风选择器
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [micSelectorOpen, setMicSelectorOpen] = useState(false);
  const [micVolume, setMicVolume] = useState(0);

  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceProviderRef = useRef(roomMeta.providers.voice);
  const micEnabledRef = useRef(false);
  const participantIdentityRef = useRef("");
  const speakerModeRef = useRef<RoomSpeakerMode>("self");
  const pendingVoiceRestartAfterSpeakerSwitchRef = useRef(false);
  const voiceCallStartingRef = useRef(false);
  const attachedTranscriptionParticipantsRef = useRef(new Map<string, string | null>());
  const transcriptionAttachmentWaiterRef = useRef<{
    participantIdentity: string;
    expectedTrackSid: string | null;
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: number;
  } | null>(null);
  const previousOwnerActiveRef = useRef(false);

  // 麦克风音量监控
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micVolumeRafRef = useRef<number | null>(null);
  const micMonitorStreamRef = useRef<MediaStream | null>(null);

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

  const clearPendingTranscriptionAttachmentWaiter = useCallback((error?: Error) => {
    const waiter = transcriptionAttachmentWaiterRef.current;
    if (!waiter) {
      return;
    }

    window.clearTimeout(waiter.timeoutId);
    transcriptionAttachmentWaiterRef.current = null;
    if (error) {
      waiter.reject(error);
      return;
    }
    waiter.resolve();
  }, []);

  const createInterruptedTranscriptionStartError = useCallback(
    () =>
      new Error(
        t("上一次转录启动已被中断。", "A previous transcription start was interrupted."),
      ),
    [t],
  );

  const resetTranscriptionAttachmentState = useCallback((error?: Error) => {
    attachedTranscriptionParticipantsRef.current.clear();
    clearPendingTranscriptionAttachmentWaiter(error ?? createInterruptedTranscriptionStartError());
  }, [clearPendingTranscriptionAttachmentWaiter, createInterruptedTranscriptionStartError]);

  const markParticipantTranscriptionAttached = useCallback(
    (participantIdentity: string, trackSid: string | null) => {
      attachedTranscriptionParticipantsRef.current.set(participantIdentity, trackSid);
      if (
        transcriptionAttachmentWaiterRef.current?.participantIdentity === participantIdentity &&
        (
          transcriptionAttachmentWaiterRef.current.expectedTrackSid === null ||
          transcriptionAttachmentWaiterRef.current.expectedTrackSid === trackSid
        )
      ) {
        clearPendingTranscriptionAttachmentWaiter();
      }
    },
    [clearPendingTranscriptionAttachmentWaiter],
  );

  const markParticipantTranscriptionDetached = useCallback((participantIdentity: string, trackSid: string | null) => {
    const attachedTrackSid = attachedTranscriptionParticipantsRef.current.get(participantIdentity);
    if (attachedTrackSid === undefined) {
      return;
    }

    if (trackSid !== null && attachedTrackSid !== null && attachedTrackSid !== trackSid) {
      return;
    }

    attachedTranscriptionParticipantsRef.current.delete(participantIdentity);
  }, []);

  const waitForParticipantTranscriptionAttachment = useCallback(
    (participantIdentity: string, expectedTrackSid: string | null, timeoutMs: number) =>
      new Promise<void>((resolve, reject) => {
        const attachedTrackSid = attachedTranscriptionParticipantsRef.current.get(participantIdentity);
        if (
          attachedTrackSid !== undefined &&
          (expectedTrackSid === null || attachedTrackSid === expectedTrackSid)
        ) {
          resolve();
          return;
        }

        clearPendingTranscriptionAttachmentWaiter(createInterruptedTranscriptionStartError());

        const timeoutId = window.setTimeout(() => {
          if (transcriptionAttachmentWaiterRef.current?.participantIdentity !== participantIdentity) {
            return;
          }
          transcriptionAttachmentWaiterRef.current = null;
          reject(
            new Error(
              t(
                "转录引擎没有及时附着到当前麦克风，请重试。",
                "Transcription did not attach to the active microphone in time. Please retry.",
              ),
            ),
          );
        }, timeoutMs);

        transcriptionAttachmentWaiterRef.current = {
          participantIdentity,
          expectedTrackSid,
          resolve,
          reject,
          timeoutId,
        };
      }),
    [clearPendingTranscriptionAttachmentWaiter, createInterruptedTranscriptionStartError, t],
  );

  // ============== 麦克风选择器辅助函数 ==============

  const stopVolumeMonitor = useCallback(() => {
    if (micVolumeRafRef.current !== null) {
      cancelAnimationFrame(micVolumeRafRef.current);
      micVolumeRafRef.current = null;
    }
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    micAnalyserRef.current = null;
    if (micAudioContextRef.current) {
      void micAudioContextRef.current.close().catch(() => undefined);
      micAudioContextRef.current = null;
    }
    if (micMonitorStreamRef.current) {
      micMonitorStreamRef.current.getTracks().forEach((t) => t.stop());
      micMonitorStreamRef.current = null;
    }
    setMicVolume(0);
  }, []);

  const startVolumeMonitor = useCallback(async (deviceId: string) => {
    stopVolumeMonitor();
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micMonitorStreamRef.current = stream;
      const ctx = new AudioContext();
      micAudioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      micAnalyserRef.current = analyser;
      const source = ctx.createMediaStreamSource(stream);
      micSourceRef.current = source;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!micAnalyserRef.current) return;
        micAnalyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicVolume(Math.min(1, avg / 80));
        micVolumeRafRef.current = requestAnimationFrame(tick);
      };
      micVolumeRafRef.current = requestAnimationFrame(tick);
    } catch {
      // 权限被拒或设备不可用，忽略
    }
  }, [stopVolumeMonitor]);

  const loadMicDevices = useCallback(async () => {
    try {
      // 先请求权限，确保设备标签可读
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      setMicDevices(audioInputs);
      setSelectedMicId((prev) => {
        if (prev && audioInputs.some((d) => d.deviceId === prev)) return prev;
        return audioInputs[0]?.deviceId ?? "";
      });
    } catch {
      // 无权限或不支持
    }
  }, []);

  const prepareMicrophoneForCall = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
        throw new Error(t("褰撳墠鐜涓嶆敮鎸侀害鍏嬮璁惧", "Microphone devices are not available in this environment"));
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      const activeRoom = roomRef.current;
      const roomDeviceId = activeRoom?.getActiveDevice("audioinput")?.trim() ?? "";
      const nextSelectedDeviceId =
        [selectedMicId, roomDeviceId].find(
          (deviceId) => deviceId && audioInputs.some((device) => device.deviceId === deviceId),
        ) ?? audioInputs[0]?.deviceId ?? "";

      setMicDevices(audioInputs);
      setSelectedMicId(nextSelectedDeviceId);

      if (!nextSelectedDeviceId) {
        throw new Error(t("鏈壘鍒板彲鐢ㄩ害鍏嬮", "No microphone available"));
      }

      return nextSelectedDeviceId;
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
          throw new Error(t("楹﹀厠椋庢潈闄愯鎷掔粷", "Microphone access was denied"));
        }
        if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
          throw new Error(t("鏈壘鍒板彲鐢ㄩ害鍏嬮", "No microphone available"));
        }
        if (error.name === "NotReadableError" || error.name === "AbortError") {
          throw new Error(t("楹﹀厠椋庢鍦ㄨ鍏朵粬搴旂敤鍗犵敤鎴栨殏鏃朵笉鍙敤", "The microphone is busy or unavailable"));
        }
      }

      throw error;
    }
  }, [selectedMicId, t]);

  const selectMic = useCallback((deviceId: string) => {
    setSelectedMicId(deviceId);
    void startVolumeMonitor(deviceId);

    const activeRoom = roomRef.current;
    if (!activeRoom || connectionState !== "connected") {
      return;
    }

    void activeRoom.switchActiveDevice("audioinput", deviceId).catch((error) => {
      setRoomError(
        error instanceof Error ? error.message : t("切换麦克风失败", "Failed to switch microphone"),
      );
    });
  }, [connectionState, startVolumeMonitor, t]);

  const toggleMicSelector = useCallback(async () => {
    setMicSelectorOpen((open) => {
      if (!open) {
        // 即将展开：加载设备列表
        void loadMicDevices();
      } else {
        // 即将关闭：停止监控
        stopVolumeMonitor();
      }
      return !open;
    });
  }, [loadMicDevices, stopVolumeMonitor]);

  // 当开关麦克风时同步触发音量监控
  useEffect(() => {
    if (micEnabled && selectedMicId) {
      void startVolumeMonitor(selectedMicId);
      return;
    }

    stopVolumeMonitor();
  }, [micEnabled, selectedMicId, startVolumeMonitor, stopVolumeMonitor]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopVolumeMonitor();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============== 麦克风选择器辅助函数结束 ==============

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
    const localMicrophoneTrackSid = getPublishedMicrophoneTrackSid(targetRoom.localParticipant);
    const localParticipantIdentity = participantIdentityRef.current.trim();
    const localTranscriptionAttached =
      Boolean(localParticipantIdentity) &&
      Boolean(localMicrophoneTrackSid) &&
      attachedTranscriptionParticipantsRef.current.get(localParticipantIdentity) === localMicrophoneTrackSid;
    const anyParticipantTranscriptionAttached = attachedTranscriptionParticipantsRef.current.size > 0;
    const roomTranscriptionReady = anyParticipantTranscriptionAttached;

    setMicEnabled(localVoiceActive);
    if (!voiceProvider.transcriberEnabled || !voiceProvider.transcription.ready) {
      setTranscriptionState("disabled");
      return;
    }

    if (voiceCallStartingRef.current) {
      setTranscriptionState(localVoiceActive && localTranscriptionAttached ? "ready" : "starting");
      return;
    }

    if (!hasActiveVoiceSession) {
      setTranscriptionState("idle");
      return;
    }

    setTranscriptionState(localVoiceActive ? (localTranscriptionAttached ? "ready" : "starting") : (roomTranscriptionReady ? "ready" : "starting"));
  }, []);

  const disconnectRoom = useCallback(
    (options?: { updateState?: boolean }) => {
      const updateState = options?.updateState ?? true;

      clearConnectionIdleTimer();
      const activeRoom = roomRef.current;
      roomRef.current = null;
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      resetTranscriptionAttachmentState();
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
    [clearConnectionIdleTimer, disableLocalMicrophone, resetTranscriptionAttachmentState],
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
      analysisEnabled: payload.room.analysisEnabled,
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

  const waitForTranscriberParticipantConnected = useCallback(
    (room: Room, timeoutMs: number) =>
      new Promise<void>((resolve, reject) => {
        if (hasConnectedTranscriberParticipant(room)) {
          resolve();
          return;
        }

        const cleanup = () => {
          window.clearTimeout(timeoutId);
          room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
          room.off(RoomEvent.Disconnected, handleRoomDisconnected);
        };

        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(
            new Error(
              t(
                "转录引擎没有及时加入房间，请重试。",
                "The transcriber did not join the room in time. Please retry.",
              ),
            ),
          );
        }, timeoutMs);

        const handleParticipantConnected = () => {
          if (!hasConnectedTranscriberParticipant(room)) {
            return;
          }

          cleanup();
          resolve();
        };

        const handleRoomDisconnected = () => {
          cleanup();
          reject(
            new Error(
              t(
                "启动转录时房间连接中断。",
                "The room disconnected while starting transcription.",
              ),
            ),
          );
        };

        room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
        room.on(RoomEvent.Disconnected, handleRoomDisconnected);
      }),
    [t],
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
    resetTranscriptionAttachmentState();
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
      room.on(RoomEvent.MediaDevicesError, (error) => {
        if (roomRef.current !== room) {
          return;
        }
        setRoomError(error instanceof Error ? error.message : t("麦克风设备不可用", "Microphone device error"));
      });
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic === LIVEKIT_TRANSCRIPTION_STATUS_TOPIC) {
          const event = decodeLivekitTranscriptionStatusEvent(payload);
          if (!event || event.roomId !== roomId) {
            return;
          }

          if (event.status === "attached") {
            markParticipantTranscriptionAttached(event.participantIdentity, event.trackSid);
          } else {
            markParticipantTranscriptionDetached(event.participantIdentity, event.trackSid);
          }

          if (roomRef.current === room) {
            syncVoiceSessionState(room);
          }
          return;
        }

        if (topic !== LIVEKIT_CHAT_MESSAGE_TOPIC) {
          return;
        }

        const event = decodeLivekitChatMessageEvent(payload);
        if (!event || event.roomId !== roomId) {
          return;
        }

        upsertMessages([event.message]);
        if (event.message.type === "transcript" && roomRef.current === room) {
          if (
            event.message.participantId &&
            event.message.participantId !== participantIdentityRef.current.trim()
          ) {
            markParticipantTranscriptionAttached(event.message.participantId, null);
          }
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
    markParticipantTranscriptionAttached,
    markParticipantTranscriptionDetached,
    releaseVoiceRuntimeIfIdle,
    resetTranscriptionAttachmentState,
    roomId,
    roomMeta.status,
    syncVoiceSessionState,
    t,
    upsertMessages,
  ]);

  const ensureVoiceRuntime = useCallback(async (room: Room) => {
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
      resetTranscriptionAttachmentState();
      setTranscriptionState("disabled");
      return {
        transcriberEnabled: false,
      };
    }

    resetTranscriptionAttachmentState();
    setTranscriptionState("starting");
    await waitForTranscriberParticipantConnected(room, TRANSCRIBER_PARTICIPANT_TIMEOUT_MS);
    return {
      transcriberEnabled: true,
    };
  }, [resetTranscriptionAttachmentState, roomId, t, waitForTranscriberParticipantConnected]);

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
    setVoiceCallStarting(true);
    resetTranscriptionAttachmentState();
    let shouldReleaseVoiceRuntime = false;
    let microphoneEnabledDuringAttempt = false;

    try {
      const preparedMicId = await prepareMicrophoneForCall();
      shouldReleaseVoiceRuntime = true;
      const runtimeState = await ensureVoiceRuntime(activeRoom);
      await activeRoom.switchActiveDevice("audioinput", preparedMicId);

      await activeRoom.localParticipant.setMicrophoneEnabled(true);
      microphoneEnabledDuringAttempt = true;

      if (runtimeState.transcriberEnabled) {
        const localParticipantIdentity =
          participantIdentityRef.current.trim() || activeRoom.localParticipant.identity.trim();
        if (!localParticipantIdentity) {
          throw new Error(
            t(
              "无法确定当前参与者身份，无法验证转录状态。",
              "Could not determine the current participant identity to verify transcription readiness.",
            ),
          );
        }

        const localMicrophoneTrackSid = getPublishedMicrophoneTrackSid(activeRoom.localParticipant);
        if (!localMicrophoneTrackSid) {
          throw new Error(
            t(
              "当前麦克风轨道未能成功发布，无法启动转录。",
              "The microphone track did not publish successfully, so transcription could not start.",
            ),
          );
        }

        await waitForParticipantTranscriptionAttachment(
          localParticipantIdentity,
          localMicrophoneTrackSid,
          TRANSCRIPTION_ATTACHMENT_TIMEOUT_MS,
        );
      }

      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
        armConnectionIdleTimer();
      }
    } catch (error) {
      resetTranscriptionAttachmentState(
        error instanceof Error ? error : createInterruptedTranscriptionStartError(),
      );
      if (microphoneEnabledDuringAttempt || hasPublishedMicrophoneTrack(activeRoom.localParticipant)) {
        await disableLocalMicrophone(activeRoom).catch(() => undefined);
      }
      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
        armConnectionIdleTimer();
      }
      if (shouldReleaseVoiceRuntime) {
        await releaseVoiceRuntimeIfIdle().catch(() => undefined);
      }
      setTranscriptionState(getIdleTranscriptionState(voiceProviderRef.current));
      setRoomError(error instanceof Error ? error.message : t("开启通话失败", "Failed to start call"));
    } finally {
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
      }
    }
  }, [
    armConnectionIdleTimer,
    createInterruptedTranscriptionStartError,
    connectionState,
    disableLocalMicrophone,
    ensureVoiceRuntime,
    micEnabled,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
    releaseVoiceRuntimeIfIdle,
    resetTranscriptionAttachmentState,
    transcriptionState,
    prepareMicrophoneForCall,
    syncVoiceSessionState,
    t,
    waitForParticipantTranscriptionAttachment,
  ]);

  const leaveVoiceCall = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom || connectionState !== "connected" || !micEnabled) {
      return;
    }

    setRoomError("");
    try {
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      resetTranscriptionAttachmentState();
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
    resetTranscriptionAttachmentState,
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
        setVoiceCallStarting(false);
        resetTranscriptionAttachmentState();
        await disableLocalMicrophone(roomRef.current);
        await releaseVoiceRuntimeIfIdle();
      } catch {
        // Best-effort cleanup before reconnecting under the other speaker identity.
      }
    }

    setHasAutoConnectAttempted(false);
    disconnectRoom();
  }

  async function toggleRealtimeAnalysis() {
    if (!roomMeta.isCreator || analysisTogglePending || roomMeta.status === "ENDED") {
      return;
    }

    setAnalysisTogglePending(true);
    setRoomError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !roomMeta.analysisEnabled,
        }),
      });
      const payload = (await response.json()) as {
        room?: { analysisEnabled: boolean };
        error?: string;
      };
      if (!response.ok || !payload.room) {
        throw new Error(payload.error ?? t("更新分析开关失败", "Failed to update analysis toggle"));
      }

      setRoomMeta((current) => ({
        ...current,
        analysisEnabled: payload.room!.analysisEnabled,
      }));
    } catch (error) {
      setRoomError(
        error instanceof Error ? error.message : t("更新分析开关失败", "Failed to update analysis toggle"),
      );
    } finally {
      setAnalysisTogglePending(false);
    }
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
      setVoiceCallStarting(false);
      resetTranscriptionAttachmentState();
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

    const minHeight = 64;
    const maxHeight = 168;
    input.style.height = "auto";
    const newHeight = Math.max(input.scrollHeight, minHeight);
    input.style.height = `${Math.min(newHeight, maxHeight)}px`;
    input.style.overflowY = newHeight > maxHeight ? "auto" : "hidden";
  }, [chatInput]);

  useEffect(() => {
    return () => {
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle();
      }
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      disconnectRoom({ updateState: false });
    };
  }, [disconnectRoom, releaseVoiceRuntimeIfIdle]);

  useEffect(() => {
    const handlePageHide = () => {
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle({ keepalive: true });
      }
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
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

  const copyRoomId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy errors
    }
  }, [roomId]);

  const isEnded = roomMeta.status === "ENDED";
  const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
  const roomInteractionBlocked = isEnded || !ownerActive;

  const isInitialConnectionPending =
    connectionState === "disconnected" && !hasAutoConnectAttempted && !roomInteractionBlocked;
  const roomConnectionStatusClass = isInitialConnectionPending ? "connecting" : connectionState;
  const roomDisplayName = getRoomDisplayName(roomMeta.roomName, roomId);
  const currentSpeakerName = getRoomSpeakerDisplayName(username, speakerMode);
  const canLeaveVoiceCall = micEnabled && !voiceCallStarting;
  const startingCallButtonLabel = t("启动中", "Starting");
  const callButtonClassName = canLeaveVoiceCall || voiceCallStarting ? "primary-btn" : "ghost-btn";
  const analysisViewState = buildAnalysisViewState(messages, userId);
  const scores = analysisViewState.scores;
  const overallInsights = analysisViewState.overallInsights;
  const suggestions = analysisViewState.suggestions;

  const renderSidebarContent = () => (
    <>
      <div className="sidebar-section">
        <h4>{t("实时比分", "Real-time Score")}</h4>
        <div className="score-card">
          <div className="score-box">
            <span className="label">{t("我方", "Our Side")}</span>
            <span className="value" style={{ color: scores.own >= scores.other ? 'var(--primary)' : 'inherit' }}>{scores.own}</span>
          </div>
          <div className="score-box">
            <span className="label">{t("对方", "Other Side")}</span>
            <span className="value" style={{ color: scores.other >= scores.own ? 'var(--primary)' : 'inherit' }}>{scores.other}</span>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h4>{t("双方观点", "Perspectives")}</h4>
        <div className="overall-insight-box">
          <div className="overall-insight-item">
            <strong>{t("我方", "Our Side")}</strong>
            <p className="analysis-insight" style={{ fontSize: '0.85rem' }}>{overallInsights.own || t("暂无洞察", "No insights yet")}</p>
          </div>
          <div style={{ height: '1px', background: 'var(--line)' }} />
          <div className="overall-insight-item">
            <strong>{t("对方", "Other Side")}</strong>
            <p className="analysis-insight" style={{ fontSize: '0.85rem' }}>{overallInsights.other || t("暂无洞察", "No insights yet")}</p>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h4>{t("建议", "Suggestions")}</h4>
        <div className="overall-insight-box">
          <div className="overall-insight-item">
            <strong>{t("我方", "Our Side")}</strong>
            {suggestions.own.length > 0 ? (
              <ul style={{ paddingLeft: '16px', margin: '4px 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                {suggestions.own.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            ) : (
              <p className="analysis-insight" style={{ fontSize: '0.85rem' }}>{t("暂无建议", "No suggestions yet")}</p>
            )}
          </div>
          <div style={{ height: '1px', background: 'var(--line)' }} />
          <div className="overall-insight-item">
            <strong>{t("对方", "Other Side")}</strong>
            {suggestions.other.length > 0 ? (
              <ul style={{ paddingLeft: '16px', margin: '4px 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                {suggestions.other.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            ) : (
              <p className="analysis-insight" style={{ fontSize: '0.85rem' }}>{t("暂无建议", "No suggestions yet")}</p>
            )}
          </div>
        </div>
      </div>

      <div className="sidebar-section" style={{ marginTop: 'auto' }}>
        <h4>{t("服务状态", "Providers")}</h4>
        <div className="key-status-grid" style={{ fontSize: '0.75rem', gap: '8px', background: 'transparent', padding: 0 }}>
          <div className="provider-tooltip">
            <div className="room-status provider-chip provider-chip-panel" tabIndex={0}>
              <div className="provider-chip-main">
                <span className="provider-chip-label">{t("语音与转录", "Voice & Transcription")}</span>
                <strong className="provider-chip-value">{getVoiceProviderLabel(roomMeta.providers.voice, language)}</strong>
              </div>
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

          {/* 麦克风选择器 */}
          {(() => {
            const selectedDevice = micDevices.find((d) => d.deviceId === selectedMicId);
            const selectedLabel = selectedDevice
              ? (selectedDevice.label || (isZh ? `麦克风 ${micDevices.indexOf(selectedDevice) + 1}` : `Microphone ${micDevices.indexOf(selectedDevice) + 1}`))
              : (isZh ? "默认麦克风" : "Default Mic");
            return (
              <div className="mic-selector-wrap" style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="room-status provider-chip provider-chip-panel mic-selector-trigger"
                  onClick={() => void toggleMicSelector()}
                  aria-expanded={micSelectorOpen}
                  aria-label={isZh ? "选择麦克风" : "Select microphone"}
                >
                  <span className="provider-chip-label mic-selector-label">{t("麦克风", "Microphone")}</span>
                  <div className="mic-selector-content">
                    <span className="provider-chip-label">{isZh ? "麦克风" : "Microphone"}</span>
                    <strong className="provider-chip-value mic-selector-value" title={selectedLabel}>{selectedLabel}</strong>
                  </div>
                  <span
                    className="mic-vol-icon"
                    style={{ "--mic-vol": micVolume } as CSSProperties}
                    aria-hidden="true"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </span>
                </button>

                {micSelectorOpen && (
                  <>
                    {/* 点击外部关闭 */}
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 98 }}
                      onClick={() => { setMicSelectorOpen(false); stopVolumeMonitor(); }}
                      aria-hidden="true"
                    />
                    <div className="mic-dropdown" role="listbox" aria-label={isZh ? "麦克风设备" : "Microphone devices"}>
                      {/* 实时音量条 */}
                      <div className="mic-vol-bar-wrap">
                        <div
                          className="mic-vol-bar-fill"
                          style={{ width: `${Math.round(micVolume * 100)}%` }}
                        />
                        <span className="mic-vol-label">
                          {isZh ? "实时音量" : "Level"}
                          <strong style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
                            {Math.round(micVolume * 100)}%
                          </strong>
                        </span>
                      </div>

                      {/* 设备列表 */}
                      <ul className="mic-device-list" role="group">
                        {micDevices.length === 0 ? (
                          <li className="mic-device-item mic-device-empty">
                            {isZh ? "未找到麦克风设备" : "No microphone found"}
                          </li>
                        ) : (
                          micDevices.map((device, idx) => {
                            const label = device.label || (isZh ? `麦克风 ${idx + 1}` : `Microphone ${idx + 1}`);
                            const isActive = device.deviceId === selectedMicId;
                            return (
                              <li key={device.deviceId} role="option" aria-selected={isActive}>
                                <button
                                  type="button"
                                  className={`mic-device-item ${isActive ? "mic-device-active" : ""}`}
                                  onClick={(e) => { e.stopPropagation(); selectMic(device.deviceId); }}
                                >
                                  <span className="mic-device-check" aria-hidden="true">
                                    {isActive ? (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    ) : null}
                                  </span>
                                  <span className="mic-device-label">{label}</span>
                                </button>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <div className="provider-tooltip">
            <div className="room-status provider-chip provider-chip-panel" tabIndex={0}>
              <div className="provider-chip-main">
                <span className="provider-chip-label">{t("大模型分析", "LLM Analysis")}</span>
                <strong className="provider-chip-value">{getAnalysisProviderLabel(roomMeta.providers.analysis, language)}</strong>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={roomMeta.analysisEnabled}
                aria-label={t("切换实时大模型分析", "Toggle realtime LLM analysis")}
                className={`provider-chip-switch ${roomMeta.analysisEnabled ? "active" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleRealtimeAnalysis();
                }}
                disabled={!roomMeta.isCreator || analysisTogglePending || roomMeta.status === "ENDED"}
              >
                <span className="provider-chip-switch-track">
                  <span className="provider-chip-switch-thumb" />
                </span>
                <span className="provider-chip-switch-text">
                  {analysisTogglePending
                    ? "..."
                    : roomMeta.analysisEnabled
                      ? t("开", "On")
                      : t("关", "Off")}
                </span>
              </button>
            </div>
            <div className="provider-popover" role="tooltip">
              <div className="provider-popover-title">
                {t("大模型分析", "LLM Analysis")}
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
    </>
  );

  // Helper to render AI Analysis
  const AnalysisMessage = ({ message }: { message: ChatMessage }) => {
    try {
      const analysisView = analysisViewState.messageViews.get(message.id);
      const data = analysisView?.content ?? parseRealtimeAnalysisMessage(message);
      if (!data) throw new Error("Not realtime");

      const isRaw = rawMessageId === message.id;
      const ownSourceLabel = analysisView ? analysisView.ownSourceLabel : "A";
      const otherSourceLabel = analysisView ? analysisView.otherSourceLabel : "B";
      const otherRoundScore = getAnalysisRoundScore(data, otherSourceLabel);
      const ownRoundScore = getAnalysisRoundScore(data, ownSourceLabel);
      const otherCurrentRoundInsight = getAnalysisInsight(data, "currentRound", otherSourceLabel);
      const ownCurrentRoundInsight = getAnalysisInsight(data, "currentRound", ownSourceLabel);

      return (
        <div className="bubble analysis">
          {isRaw ? (
            <pre style={{ fontSize: '0.75rem', overflowX: 'auto', background: 'rgba(0,0,0,0.03)', padding: '10px', borderRadius: '8px', color: '#000' }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          ) : (
            <div className="analysis-grid">
              <div className="analysis-side-section">
                <div className="analysis-side-head">
                  <div className="analysis-side-h">{t("对方", "Other Side")}</div>
                  {otherRoundScore && (
                    <span className="analysis-delta-tag">
                      {otherRoundScore.delta >= 0 ? '+' : ''}{otherRoundScore.delta}
                    </span>
                  )}
                </div>
                <p className="analysis-insight">{otherCurrentRoundInsight || t("本轮无发言", "No activity this round")}</p>
                {otherRoundScore?.reason && (
                  <span className="analysis-score-reason">{otherRoundScore.reason}</span>
                )}
              </div>

              <div className="analysis-side-section">
                <div className="analysis-side-head">
                  <div className="analysis-side-h">{t("我方", "Our Side")}</div>
                  {ownRoundScore && (
                    <span className="analysis-delta-tag">
                      {ownRoundScore.delta >= 0 ? '+' : ''}{ownRoundScore.delta}
                    </span>
                  )}
                </div>
                <p className="analysis-insight">{ownCurrentRoundInsight || t("本轮无发言", "No activity this round")}</p>
                {ownRoundScore?.reason && (
                  <span className="analysis-score-reason">{ownRoundScore.reason}</span>
                )}
              </div>
            </div>
          )}
          
          <button 
            className="raw-toggle" 
            onClick={() => setRawMessageId(isRaw ? null : message.id)}
          >
            {isRaw ? t("查看精简版", "Minimal") : t("查看原文", "Raw JSON")}
          </button>
        </div>
      );
    } catch {
      return (
        <div className="bubble analysis">
          <header className="bubble-meta">
            <strong>{t("AI 分析", "AI Analysis")}</strong>
            <time dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time>
          </header>
          <p>{message.content}</p>
        </div>
      );
    }
  };

  return (
    <main className="room-page">
      <section className="room-shell room-shell-chat">
        <header className="room-header">
          <div className="room-header-title">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1>{roomDisplayName}</h1>
              
              <div style={{ position: 'relative' }}>
                <span 
                  className={`room-status ${roomConnectionStatusClass}`}
                  onClick={() => setActiveStatusTooltip(activeStatusTooltip === "connection" ? null : "connection")}
                >
                  <span className="status-icon">C</span>
                  <span className="status-label-text">
                    {connectionState === "connected"
                      ? t("已连接", "Connected")
                      : connectionState === "connecting" || isInitialConnectionPending
                        ? t("连接中", "Connecting")
                        : t("断开", "Disconnected")}
                  </span>
                </span>
                {activeStatusTooltip === "connection" && (
                  <div className="status-tooltip">
                    {connectionState === "connected"
                      ? t("房间连接成功", "Room Connected")
                      : connectionState === "connecting" || isInitialConnectionPending
                        ? t("正在连接房间...", "Connecting to Room...")
                        : t("房间连接已断开", "Room Disconnected")}
                  </div>
                )}
              </div>

              <div style={{ position: 'relative' }}>
                <span 
                  className={`room-status transcription-status ${transcriptionState}`}
                  onClick={() => setActiveStatusTooltip(activeStatusTooltip === "transcription" ? null : "transcription")}
                >
                  <span className="status-icon">T</span>
                  <span className="status-label-text">
                    {transcriptionState === "ready"
                      ? t("转录中", "Transcription On")
                      : transcriptionState === "starting"
                        ? t("启动中", "Starting")
                        : t("转录关", "Transcription Off")}
                  </span>
                </span>
                {activeStatusTooltip === "transcription" && (
                  <div className="status-tooltip">
                    {transcriptionState === "ready"
                      ? t("实时语音转录已开启", "Transcription Active")
                      : transcriptionState === "starting"
                        ? t("正在启动转录引擎...", "Starting Transcription...")
                        : t("语音转录未开启", "Transcription Disabled")}
                  </div>
                )}
              </div>
            </div>
            <div className="room-meta-row">
              <span 
                className="room-header-code" 
                onClick={() => void copyRoomId()}
                title={t("点击复制房间号", "Click to copy room ID")}
              >
                {roomId}
                {copied && <span className="copy-tooltip">{t("已复制", "Copied")}</span>}
              </span>
              <span style={{ opacity: 0.5 }}>|</span>
              <span>@{username}</span>
              {roomMeta.features.speakerSwitchEnabled && currentSpeakerName !== username && (
                <>
                  <span style={{ opacity: 0.5 }}>|</span>
                  <span>{currentSpeakerName}</span>
                </>
              )}
            </div>
          </div>
          <Link className="room-back-link" href="/" title={t("返回", "Back")}>
            <span className="desktop-only ghost-btn" style={{ height: '40px' }}>{t("返回", "Back")}</span>
            <span className="mobile-only-flex back-icon-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </span>
          </Link>
          <div className="room-actions">
            <button
              type="button"
              className="ghost-btn mobile-only-flex"
              style={{ height: '40px' }}
              onClick={() => setShowMobileAnalysis(true)}
            >
              {t("详情", "Details")}
            </button>
            {roomMeta.features.speakerSwitchEnabled && (
              <button
                type="button"
                className="ghost-btn"
                style={{ height: '40px' }}
                onClick={() => {
                  if (hasConfirmedSwitchOnce) {
                    void switchSpeakerMode();
                  } else {
                    setShowSwitchConfirm(true);
                  }
                }}
                disabled={isEnded || connectionState === "connecting" || speakerSwitchPending}
              >
                {speakerSwitchPending 
                  ? "..." 
                  : speakerMode === "self" 
                    ? <><span className="desktop-only">{t("切换", "Switch")}</span><span className="mobile-only">{t("切换", "Switch")}</span></>
                    : <><span className="desktop-only">{t("退出切换", "Exit")}</span><span className="mobile-only">{t("退出", "Exit")}</span></>}
              </button>
            )}
            {roomMeta.isCreator && (
              <button 
                type="button" 
                className="destructive-btn" 
                style={{ height: '40px' }} 
                onClick={() => setShowEndRoomConfirm(true)} 
                disabled={endingRoom || isEnded}
              >
                {endingRoom ? "..." : <><span className="desktop-only">{t("结束房间", "End Room")}</span><span className="mobile-only">{t("结束", "End")}</span></>}
              </button>
            )}
          </div>
        </header>

        {roomError && (
          <div className="room-error-box">
            <span style={{ fontSize: '1.2rem' }}>&bull;</span>
            {roomError}
          </div>
        )}

        <section className="chat-panel">
          <div className="chat-scroll">
            {messages.length === 0 ? (
              <p className="empty-chat">{t("暂无对话内容。", "Silence.")}</p>
            ) : (
              messages.map((message) => {
                if (message.type === "analysis") {
                  return (
                    <div key={message.id} className="message-row announcement">
                      <AnalysisMessage message={message} />
                    </div>
                  );
                }

                const announcement = message.type === "summary";
                const own = announcement ? false : isOwnMessage(message, userId, username);
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
                          {announcement ? t("最终总结", "Final Summary") : own ? t("我", "Me") : message.senderName}
                        </strong>
                        <span className="bubble-source">
                          {message.type === "transcript" ? t("音", "V") : t("文", "T")}
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
              isEnded ? t("只读模式", "Read-only") : t("输入消息...", "Type a message...")
            }
            disabled={roomInteractionBlocked}
            rows={1}
          />
          <div className="room-chat-controls">
            {connectionState === "connected" ? (
              <button
                type="button"
                className={callButtonClassName}
                onClick={() => void (canLeaveVoiceCall ? leaveVoiceCall() : startVoiceCall())}
                disabled={roomInteractionBlocked || voiceCallStarting}
                aria-busy={voiceCallStarting}
                data-busy-label={startingCallButtonLabel}
              >
                {micEnabled ? t("退出通话", "Leave") : t("通话", "Call")}
              </button>
            ) : !roomInteractionBlocked && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void connectRoom()}
                disabled={connectionState === "connecting"}
              >
                {t("重连", "Reconnect")}
              </button>
            )}

            <button type="submit" className="primary-btn" disabled={sendingText || roomInteractionBlocked}>
              {t("发送", "Send")}
            </button>
          </div>
        </form>

        <div ref={audioContainerRef} className="audio-container" />
      </section>

      <aside className="room-sidebar">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Analysis Drawer */}
      <div 
        className={`mobile-analysis-overlay ${showMobileAnalysis ? 'active' : ''}`} 
        onClick={() => setShowMobileAnalysis(false)} 
      />
      <div className={`mobile-analysis-drawer ${showMobileAnalysis ? 'active' : ''}`}>
        <button className="drawer-close-btn" onClick={() => setShowMobileAnalysis(false)}>
          ✕
        </button>
        <h2 style={{ margin: '0 0 8px', fontSize: '1.4rem', fontWeight: 800 }}>{t("分析与统计", "Analysis & Stats")}</h2>
        {renderSidebarContent()}
      </div>

      {showEndRoomConfirm && (
        <div className="auth-modal-overlay">
          <div className="auth-modal">
            <header className="auth-modal-header">
              <h2>{t("确认结束房间", "Confirm End Room")}</h2>
            </header>
            <div style={{ marginBottom: '24px', lineHeight: '1.6', color: 'var(--muted)' }}>
              {t(
                "结束后将生成总结报告，房间将无法再进行对话，只能查看对话历史。是否确认结束？",
                "A summary report will be generated. The room will no longer allow new conversation and will be read-only. Are you sure you want to end?"
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                className="ghost-btn" 
                style={{ flex: 1 }}
                onClick={() => setShowEndRoomConfirm(false)}
              >
                {t("取消", "Cancel")}
              </button>
              <button 
                className="destructive-btn" 
                style={{ flex: 1 }}
                onClick={() => {
                  setShowEndRoomConfirm(false);
                  void endConversation();
                }}
              >
                {t("确认", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSwitchConfirm && (
        <div className="auth-modal-overlay">
          <div className="auth-modal">
            <header className="auth-modal-header">
              <h2>{t("确认切换身份", "Confirm Switch Identity")}</h2>
            </header>
            <div style={{ marginBottom: '24px', lineHeight: '1.6', color: 'var(--muted)' }}>
              {t(
                "你将切换到你的模拟对手，你可以使用该模式测试或者在同一设备上双人辩论。",
                "You will switch to your simulated opponent. You can use this mode for testing or for a two-person debate on the same device."
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                className="ghost-btn" 
                style={{ flex: 1 }}
                onClick={() => setShowSwitchConfirm(false)}
              >
                {t("取消", "Cancel")}
              </button>
              <button 
                className="primary-btn" 
                style={{ flex: 1 }}
                onClick={() => {
                  setShowSwitchConfirm(false);
                  setHasConfirmedSwitchOnce(true);
                  void switchSpeakerMode();
                }}
              >
                {t("确认", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

