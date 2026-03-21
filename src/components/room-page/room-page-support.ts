import { Room, Track, type TrackPublication } from "livekit-client";

import {
  type RealtimeAnalysisContent,
  type RealtimeAnalysisRoundScore,
  type RealtimeAnalysisSide,
} from "@/features/analysis/llm/realtime-analysis";
import { type ChatMessage } from "@/lib/chat-types";
import { getRoomNameFromAnalysisContent } from "@/lib/room-name";
import { toDateLocale, type UiLanguage } from "@/lib/ui-language";

export type ProviderOwner = {
  kind: "platform" | "user" | "builtin" | "unavailable";
  username: string | null;
};

export type VoiceProviderState = {
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

export type AnalysisProviderState = {
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

export type TokenResponse = {
  token: string;
  livekitUrl: string;
  identity: string;
  displayName: string;
  canParticipate: boolean;
  transcriberEnabled: boolean;
  providers: {
    voice: VoiceProviderState;
    analysis: AnalysisProviderState;
  };
  error?: string;
};

export type MessagesResponse = {
  messages: ChatMessage[];
  error?: string;
};

export type RoomMemberState = {
  userId: string;
  username: string;
  joinedAt: string;
  lastSeenAt: string | null;
  isOwner: boolean;
  isOnline: boolean;
  debateSlot: "A" | "B" | null;
  canParticipate: boolean;
};

export type RoomMetaResponse = {
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
    currentUserCanParticipate: boolean;
    members: RoomMemberState[];
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

export type RoomPageClientProps = {
  roomId: string;
  initialRoomName: string | null;
  userId: string;
  username: string;
};

export type RoomConnectionState = "disconnected" | "connecting" | "connected";

export type TranscriptionState = "idle" | "starting" | "ready" | "disabled";

export type RoomMetaState = {
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
  currentUserCanParticipate: boolean;
  members: RoomMemberState[];
  providers: {
    voice: VoiceProviderState;
    analysis: AnalysisProviderState;
  };
  features: {
    speakerSwitchEnabled: boolean;
  };
};

export type VoiceTrackParticipant = {
  isAgent: boolean;
  getTrackPublication(source: Track.Source): TrackPublication | undefined;
};

export type AnalysisPerspectiveLabels = {
  ownSourceLabel: RealtimeAnalysisSide | null;
  otherSourceLabel: RealtimeAnalysisSide | null;
};

export type AnalysisMessageView = AnalysisPerspectiveLabels & {
  content: RealtimeAnalysisContent;
};

export type AnalysisViewState = {
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

export type RoomPageTranslate = (zh: string, en: string) => string;

export type ActiveStatusTooltipState = "connection" | "transcription" | null;

export const ROOM_CONNECTION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
export const ROOM_META_POLL_INTERVAL_MS = 5 * 1000;
export const TRANSCRIBER_PARTICIPANT_TIMEOUT_MS = 12 * 1000;
export const TRANSCRIPTION_ATTACHMENT_TIMEOUT_MS = 5 * 1000;
export const ANALYSIS_SIDE_ORDER: RealtimeAnalysisSide[] = ["A", "B"];

export function createInitialRoomMetaState(initialRoomName: string | null): RoomMetaState {
  return {
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
    currentUserCanParticipate: false,
    members: [],
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
  };
}

export function formatTime(value: string, language: UiLanguage) {
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

export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    map.set(message.id, message);
  }

  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function isConversationMessage(message: ChatMessage) {
  return message.type === "text" || message.type === "transcript";
}

export function resolveUserKeyFromParticipantId(participantId?: string | null) {
  const normalized = participantId?.trim();
  if (!normalized) {
    return null;
  }

  const match = /^user-(.+)$/.exec(normalized);
  const userId = match?.[1]?.trim();
  return userId ? `user:${userId}` : null;
}

export function resolveConversationSpeakerKey(message: ChatMessage) {
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

export function resolveConversationSpeakerLabel(index: number) {
  if (index >= 0 && index < 26) {
    return String.fromCharCode(65 + index);
  }

  return `P${index + 1}`;
}

export function isOwnMessage(message: ChatMessage, userId: string, username: string) {
  if (message.type === "analysis" || message.type === "summary") {
    return false;
  }

  const speakerKey = resolveConversationSpeakerKey(message);
  if (speakerKey) {
    return speakerKey === `user:${userId}`;
  }

  return message.senderName === username;
}

export function findLatestRoomNameFromMessages(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const roomName = getRoomNameFromAnalysisContent(messages[index].content);
    if (roomName) {
      return roomName;
    }
  }

  return null;
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

function formatProviderOwner(owner: ProviderOwner, language: UiLanguage) {
  if (owner.kind === "user") {
    return owner.username ?? (language === "zh" ? "用户" : "User");
  }

  if (owner.kind === "platform" || owner.kind === "builtin") {
    return language === "zh" ? "平台" : "Platform";
  }

  return language === "zh" ? "未配置" : "Unavailable";
}

function formatProviderValue(value: string | null | undefined, language: UiLanguage) {
  if (value && value.trim().length > 0) {
    return value;
  }

  return language === "zh" ? "未设置" : "Not set";
}

export function getVoiceProviderLabel(
  voice: RoomMetaState["providers"]["voice"],
  language: UiLanguage,
) {
  return formatProviderOwner(voice.providedBy, language);
}

export function getAnalysisProviderLabel(
  analysis: RoomMetaState["providers"]["analysis"],
  language: UiLanguage,
) {
  return formatProviderOwner(analysis.providedBy, language);
}

export function getVoiceProviderDetails(voice: VoiceProviderState, language: UiLanguage) {
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

export function getAnalysisProviderDetails(
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

export function getIdleTranscriptionState(voice: VoiceProviderState): TranscriptionState {
  return voice.transcriberEnabled && voice.transcription.ready ? "idle" : "disabled";
}

export function getOwnerOfflineError(language: UiLanguage) {
  return language === "zh"
    ? "房主当前不在房间，连接已断开。"
    : "Room owner is offline. The live room connection has been disconnected.";
}

export function getRoomParticipationBlockedError(language: UiLanguage) {
  return language === "zh"
    ? "当前仅前两位进入房间的成员可发言或上麦，其余成员为旁听只读。"
    : "Only the first two room members can speak or use voice. Later members are read-only observers.";
}

export function hasPublishedMicrophoneTrack(participant: VoiceTrackParticipant) {
  if (participant.isAgent) {
    return false;
  }

  const publication = participant.getTrackPublication(Track.Source.Microphone);
  return Boolean(publication && !publication.isMuted);
}

export function getPublishedMicrophoneTrackSid(participant: VoiceTrackParticipant) {
  if (participant.isAgent) {
    return null;
  }

  const publication = participant.getTrackPublication(Track.Source.Microphone);
  if (!publication || publication.isMuted) {
    return null;
  }

  return typeof publication.trackSid === "string" && publication.trackSid ? publication.trackSid : null;
}

export function hasConnectedTranscriberParticipant(room: Room) {
  return [...room.remoteParticipants.values()].some((participant) => participant.isAgent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseRealtimeAnalysisMessage(message: ChatMessage) {
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

export function getAnalysisInsight(
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

export function getAnalysisSuggestions(
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

export function getAnalysisRoundScore(
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

export function buildAnalysisViewState(
  messages: ChatMessage[],
  currentUserId: string,
): AnalysisViewState {
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
