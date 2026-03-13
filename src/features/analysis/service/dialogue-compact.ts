import { Message } from "@prisma/client";

export type ConversationMessageForAnalysis = Pick<
  Message,
  "id" | "senderName" | "senderUserId" | "participantId" | "content" | "createdAt"
>;

export type ConversationCursor = {
  lastRealtimeMessageId?: string | null;
  lastRealtimeMessageAt?: Date | null;
};

export type CompactedConversationBundle = {
  speakerMap: Record<string, string>;
  historyConversation: string;
  currentRoundConversation: string;
  fullConversation: string;
  hasCurrentRound: boolean;
  currentRoundActiveSpeakerLabels: string[];
  latestCurrentMessageId: string | null;
  latestCurrentMessageAt: Date | null;
};

type CompactedTurn = {
  speakerLabel: string;
  text: string;
};

type SpeakerAssignment = {
  key: string;
  label: string;
  displayName: string;
};

function normalizeText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function shouldInsertSpace(left: string, right: string) {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

function mergeText(left: string, right: string) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (right.startsWith(left)) {
    return right;
  }
  if (left.endsWith(right)) {
    return left;
  }
  return shouldInsertSpace(left, right) ? `${left} ${right}` : `${left}${right}`;
}

function resolveUserIdFromParticipantId(participantId?: string | null) {
  const normalized = participantId?.trim();
  if (!normalized) {
    return null;
  }

  const match = /^user-(.+)$/.exec(normalized);
  const userId = match?.[1]?.trim();
  return userId ? userId : null;
}

function resolveSpeakerKey(message: ConversationMessageForAnalysis) {
  const senderUserId = message.senderUserId?.trim();
  if (senderUserId) {
    return `user:${senderUserId}`;
  }

  const participantUserId = resolveUserIdFromParticipantId(message.participantId);
  if (participantUserId) {
    return `user:${participantUserId}`;
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

function resolveSpeakerLabel(index: number) {
  if (index >= 0 && index < 26) {
    return String.fromCharCode(65 + index);
  }

  return `P${index + 1}`;
}

function buildSpeakerAssignments(messages: ConversationMessageForAnalysis[]) {
  const assignments = new Map<string, SpeakerAssignment>();

  for (const message of messages) {
    const key = resolveSpeakerKey(message);
    if (assignments.has(key)) {
      continue;
    }

    const index = assignments.size;
    assignments.set(key, {
      key,
      label: resolveSpeakerLabel(index),
      displayName: message.senderName,
    });
  }

  return assignments;
}

function compactTurns(
  messages: ConversationMessageForAnalysis[],
  assignments: Map<string, SpeakerAssignment>,
): CompactedTurn[] {
  const turns: CompactedTurn[] = [];

  for (const message of messages) {
    const content = normalizeText(message.content);
    if (!content) {
      continue;
    }

    const key = resolveSpeakerKey(message);
    const assignment = assignments.get(key);
    if (!assignment) {
      continue;
    }

    const lastTurn = turns.at(-1);
    if (lastTurn && lastTurn.speakerLabel === assignment.label) {
      lastTurn.text = mergeText(lastTurn.text, content);
      continue;
    }

    turns.push({
      speakerLabel: assignment.label,
      text: content,
    });
  }

  return turns;
}

function turnsToText(turns: CompactedTurn[]) {
  return turns.map((turn) => `${turn.speakerLabel}: ${turn.text}`).join("\n");
}

function getActiveSpeakerLabels(turns: CompactedTurn[]) {
  return [...new Set(turns.map((turn) => turn.speakerLabel))];
}

function resolveSplitIndex(messages: ConversationMessageForAnalysis[], cursor?: ConversationCursor) {
  if (!cursor?.lastRealtimeMessageId && !cursor?.lastRealtimeMessageAt) {
    return 0;
  }

  if (cursor.lastRealtimeMessageId) {
    const matchedIndex = messages.findIndex((message) => message.id === cursor.lastRealtimeMessageId);
    if (matchedIndex >= 0) {
      return matchedIndex + 1;
    }
  }

  if (cursor.lastRealtimeMessageAt) {
    const matchedIndex = messages.findIndex(
      (message) => message.createdAt.getTime() > cursor.lastRealtimeMessageAt!.getTime(),
    );
    if (matchedIndex >= 0) {
      return matchedIndex;
    }
    return messages.length;
  }

  return 0;
}

function buildSpeakerMap(assignments: Map<string, SpeakerAssignment>) {
  const speakerMap: Record<string, string> = {};

  for (const assignment of assignments.values()) {
    speakerMap[assignment.label] = assignment.displayName;
  }

  return speakerMap;
}

export function compactConversationForAnalysis(
  sourceMessages: ConversationMessageForAnalysis[],
  options?: {
    cursor?: ConversationCursor;
    maxHistoryTurns?: number;
  },
): CompactedConversationBundle {
  const messages = [...sourceMessages].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  const assignments = buildSpeakerAssignments(messages);

  const splitIndex = resolveSplitIndex(messages, options?.cursor);
  const historyMessages = messages.slice(0, splitIndex);
  const currentMessages = messages.slice(splitIndex);

  const historyTurns = compactTurns(historyMessages, assignments);
  const maxHistoryTurns = options?.maxHistoryTurns ?? historyTurns.length;
  const trimmedHistoryTurns =
    maxHistoryTurns > 0 ? historyTurns.slice(Math.max(0, historyTurns.length - maxHistoryTurns)) : [];

  const currentTurns = compactTurns(currentMessages, assignments);
  const fullTurns = compactTurns(messages, assignments);

  const latestCurrentMessage = currentMessages.at(-1) ?? null;

  return {
    speakerMap: buildSpeakerMap(assignments),
    historyConversation: turnsToText(trimmedHistoryTurns),
    currentRoundConversation: turnsToText(currentTurns),
    fullConversation: turnsToText(fullTurns),
    hasCurrentRound: currentTurns.length > 0,
    currentRoundActiveSpeakerLabels: getActiveSpeakerLabels(currentTurns),
    latestCurrentMessageId: latestCurrentMessage?.id ?? null,
    latestCurrentMessageAt: latestCurrentMessage?.createdAt ?? null,
  };
}
