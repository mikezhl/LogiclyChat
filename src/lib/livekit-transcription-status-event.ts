export const LIVEKIT_TRANSCRIPTION_STATUS_TOPIC = "jileme.transcription-status.v1";

export type LivekitTranscriptionStatus = "attached" | "detached";

export type LivekitTranscriptionStatusEvent = {
  type: "transcription-status";
  version: 1;
  roomId: string;
  participantIdentity: string;
  trackSid: string | null;
  status: LivekitTranscriptionStatus;
  reason: string | null;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createLivekitTranscriptionStatusEvent(
  roomId: string,
  participantIdentity: string,
  status: LivekitTranscriptionStatus,
  trackSid: string | null,
  reason?: string | null,
): LivekitTranscriptionStatusEvent {
  return {
    type: "transcription-status",
    version: 1,
    roomId,
    participantIdentity,
    trackSid,
    status,
    reason: reason?.trim() || null,
  };
}

export function encodeLivekitTranscriptionStatusEvent(
  event: LivekitTranscriptionStatusEvent,
): Uint8Array {
  return textEncoder.encode(JSON.stringify(event));
}

export function decodeLivekitTranscriptionStatusEvent(
  payload: Uint8Array,
): LivekitTranscriptionStatusEvent | null {
  try {
    const parsed = JSON.parse(textDecoder.decode(payload)) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    if (parsed.type !== "transcription-status" || parsed.version !== 1) {
      return null;
    }

    if (
      typeof parsed.roomId !== "string" ||
      typeof parsed.participantIdentity !== "string" ||
      (parsed.trackSid !== null && typeof parsed.trackSid !== "string") ||
      (parsed.status !== "attached" && parsed.status !== "detached") ||
      (parsed.reason !== null && typeof parsed.reason !== "string")
    ) {
      return null;
    }

    return {
      type: "transcription-status",
      version: 1,
      roomId: parsed.roomId,
      participantIdentity: parsed.participantIdentity,
      trackSid: parsed.trackSid,
      status: parsed.status,
      reason: parsed.reason,
    };
  } catch {
    return null;
  }
}
