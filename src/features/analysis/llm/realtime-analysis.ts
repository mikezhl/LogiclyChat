export const REALTIME_ANALYSIS_SIDES = ["A", "B"] as const;
const DEFAULT_SUGGESTION_MAX_LENGTH = 50;
const MAX_SUGGESTION_ITEMS = 2;
const MAX_FOCUS_LENGTH = 80;
const MAX_INSIGHT_LENGTH = 80;
const MAX_SCORE_REASON_LENGTH = 80;
const MAX_ERROR_LENGTH = 200;

export type RealtimeAnalysisSide = (typeof REALTIME_ANALYSIS_SIDES)[number];

export type RealtimeAnalysisSpeakerInsights = Record<RealtimeAnalysisSide, string>;

export type RealtimeAnalysisSpeakerSuggestions = Record<RealtimeAnalysisSide, string[]>;

export type RealtimeAnalysisRoundScore = {
  delta: number;
  reason: string;
};

export type RealtimeAnalysisRoundScores = Record<
  RealtimeAnalysisSide,
  RealtimeAnalysisRoundScore | null
>;

export type RealtimeAnalysisContent = {
  type: "realtime-analysis";
  focus: string;
  insights: {
    overall: RealtimeAnalysisSpeakerInsights;
    currentRound: RealtimeAnalysisSpeakerInsights;
  };
  suggestions: RealtimeAnalysisSpeakerSuggestions;
  roundScores: RealtimeAnalysisRoundScores;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).trim();
}

function normalizeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }

  return truncateText(normalized, maxLength);
}

function normalizeSpeakerInsights(
  value: unknown,
  maxLength: number,
): RealtimeAnalysisSpeakerInsights {
  const record = isRecord(value) ? value : {};

  return {
    A: normalizeString(record.A, maxLength),
    B: normalizeString(record.B, maxLength),
  };
}

function normalizeSuggestions(
  value: unknown,
  maxLength: number,
): RealtimeAnalysisSpeakerSuggestions {
  const record = isRecord(value) ? value : {};

  return {
    A: normalizeSuggestionList(record.A, maxLength),
    B: normalizeSuggestionList(record.B, maxLength),
  };
}

function normalizeSuggestionList(value: unknown, maxLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();

  for (const item of value) {
    const normalized = normalizeString(item, maxLength);
    if (!normalized) {
      continue;
    }

    deduped.add(normalized);
    if (deduped.size >= MAX_SUGGESTION_ITEMS) {
      break;
    }
  }

  return [...deduped];
}

function parseRoundScoreDelta(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(-50, Math.min(20, Math.round(parsed)));
}

function normalizeRoundScore(value: unknown): RealtimeAnalysisRoundScore | null {
  if (!isRecord(value)) {
    return null;
  }

  const delta = parseRoundScoreDelta(value.delta);
  const reason = normalizeString(value.reason, MAX_SCORE_REASON_LENGTH);

  if (delta === null && !reason) {
    return null;
  }

  return {
    delta: delta ?? 0,
    reason,
  };
}

function normalizeRoundScores(value: unknown): RealtimeAnalysisRoundScores {
  const record = isRecord(value) ? value : {};

  return {
    A: normalizeRoundScore(record.A),
    B: normalizeRoundScore(record.B),
  };
}

export function buildEmptyRealtimeAnalysisContent(error?: string): RealtimeAnalysisContent {
  const payload: RealtimeAnalysisContent = {
    type: "realtime-analysis",
    focus: "",
    insights: {
      overall: {
        A: "",
        B: "",
      },
      currentRound: {
        A: "",
        B: "",
      },
    },
    suggestions: {
      A: [],
      B: [],
    },
    roundScores: {
      A: null,
      B: null,
    },
  };

  const normalizedError = normalizeString(error, MAX_ERROR_LENGTH);
  if (normalizedError) {
    payload.error = normalizedError;
  }

  return payload;
}

export function isMockRealtimeAnalysisDebugPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    payload.mode === "realtime" &&
    typeof payload.style === "string" &&
    typeof payload.prompt === "string" &&
    isRecord(payload.input)
  );
}

export function normalizeRealtimeAnalysisContent(
  payload: unknown,
  options?: {
    activeSpeakerLabels?: readonly string[];
    suggestionMaxLength?: number;
  },
): RealtimeAnalysisContent {
  const normalized = buildEmptyRealtimeAnalysisContent();
  const suggestionMaxLength = options?.suggestionMaxLength ?? DEFAULT_SUGGESTION_MAX_LENGTH;
  const activeSpeakerLabels = new Set(options?.activeSpeakerLabels ?? []);

  if (isRecord(payload)) {
    normalized.focus = normalizeString(payload.focus, MAX_FOCUS_LENGTH);

    const insights = isRecord(payload.insights) ? payload.insights : {};
    normalized.insights = {
      overall: normalizeSpeakerInsights(insights.overall, MAX_INSIGHT_LENGTH),
      currentRound: normalizeSpeakerInsights(insights.currentRound, MAX_INSIGHT_LENGTH),
    };

    normalized.suggestions = normalizeSuggestions(payload.suggestions, suggestionMaxLength);
    normalized.roundScores = normalizeRoundScores(payload.roundScores);

    const error = normalizeString(payload.error, MAX_ERROR_LENGTH);
    if (error) {
      normalized.error = error;
    }
  }

  for (const side of REALTIME_ANALYSIS_SIDES) {
    if (activeSpeakerLabels.has(side)) {
      if (!normalized.roundScores[side]) {
        normalized.roundScores[side] = {
          delta: 0,
          reason: "",
        };
      }
      continue;
    }

    normalized.insights.currentRound[side] = "";
    normalized.roundScores[side] = null;
  }

  return normalized;
}
