import WebSocket from "ws";
import { AudioStream, type RemoteAudioTrack } from "@livekit/rtc-node";

import { AsyncEventQueue } from "@/features/transcription/core/async-event-queue";
import type {
  CreateProviderSessionParams,
  NormalizedTranscriptionEvent,
  RealtimeTranscriptionProviderAdapter,
  RealtimeTranscriptionProviderSession,
} from "@/features/transcription/core/session";
import type { DashScopeTranscriptionRuntime } from "@/features/transcription/core/runtime";

type DashScopeRealtimeMessage = {
  type?: string;
  text?: string;
  transcript?: string;
  stash?: string;
  event_id?: string;
  item_id?: string;
  error?: unknown;
  [key: string]: unknown;
};

const AUDIO_APPEND_LOG_INTERVAL = 100;
const RAW_MESSAGE_PREVIEW_LIMIT = 800;
const TEXT_PREVIEW_LIMIT = 120;
const SESSION_FINISH_WAIT_TIMEOUT_MS = 1500;

function getDashScopeRegionHint(baseUrl: string) {
  if (baseUrl.includes("dashscope-intl.aliyuncs.com")) {
    return "intl-singapore";
  }

  if (baseUrl.includes("dashscope.aliyuncs.com")) {
    return "cn-beijing";
  }

  return "custom";
}

function getDashScopeConnectionHint(runtime: DashScopeTranscriptionRuntime, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("401")) {
    return `DashScope rejected the websocket handshake. Check whether DASHSCOPE_REALTIME_URL (${runtime.baseUrl}) matches the API key region and whether the API key is valid.`;
  }

  return undefined;
}

function buildDashScopeLogPayload(runtime: DashScopeTranscriptionRuntime, extra?: Record<string, unknown>) {
  return {
    provider: runtime.provider,
    source: runtime.source,
    credentialMask: runtime.credentialMask,
    baseUrl: runtime.baseUrl,
    regionHint: getDashScopeRegionHint(runtime.baseUrl),
    model: runtime.model,
    language: runtime.language,
    sampleRate: runtime.sampleRate,
    serverVad: runtime.serverVad,
    ...extra,
  };
}

function previewText(text: string | undefined) {
  if (!text) {
    return "";
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= TEXT_PREVIEW_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, TEXT_PREVIEW_LIMIT)}...`;
}

function previewPayload(payload: unknown) {
  try {
    const serialized = JSON.stringify(payload);
    if (!serialized) {
      return "";
    }
    if (serialized.length <= RAW_MESSAGE_PREVIEW_LIMIT) {
      return serialized;
    }
    return `${serialized.slice(0, RAW_MESSAGE_PREVIEW_LIMIT)}...<truncated>`;
  } catch {
    return String(payload);
  }
}

class DashScopeRealtimeSession implements RealtimeTranscriptionProviderSession {
  readonly runtime: DashScopeTranscriptionRuntime;

  private readonly eventQueue = new AsyncEventQueue<NormalizedTranscriptionEvent>();
  private readonly url: string;
  private readonly socket: WebSocket;
  private readonly readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private finishAckPromise: Promise<void>;
  private finishAckResolve: (() => void) | null = null;
  private audioStream: AudioStream | null = null;
  private trackSid: string | null = null;
  private consumeAudioTask: Promise<void> | null = null;
  private closed = false;
  private open = false;
  private sessionUpdated = false;
  private sessionCreated = false;
  private sessionFinished = false;
  private readonly seenMessageTypes = new Set<string>();

  constructor(runtime: DashScopeTranscriptionRuntime) {
    this.runtime = runtime;
    this.url = `${runtime.baseUrl}?model=${encodeURIComponent(runtime.model)}`;
    console.info("[transcriber] Opening DashScope realtime websocket", buildDashScopeLogPayload(runtime, {
      url: this.url,
    }));
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.finishAckPromise = new Promise<void>((resolve) => {
      this.finishAckResolve = resolve;
    });
    this.socket = new WebSocket(this.url, {
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });
    this.bindSocketEvents();
  }

  private bindSocketEvents() {
    this.socket.on("open", () => {
      this.open = true;
      console.info("[transcriber] DashScope websocket opened", buildDashScopeLogPayload(this.runtime, {
        url: this.url,
      }));
      try {
        this.sendSessionUpdate();
        this.readyResolve?.();
      } finally {
        this.readyResolve = null;
        this.readyReject = null;
      }
    });

    this.socket.on("message", (raw) => {
      let message: DashScopeRealtimeMessage;
      try {
        message = JSON.parse(raw.toString()) as DashScopeRealtimeMessage;
      } catch {
        console.warn("[transcriber] Failed to parse DashScope websocket message", buildDashScopeLogPayload(this.runtime, {
          url: this.url,
          payloadPreview: previewPayload(raw.toString()),
        }));
        return;
      }

      const messageType = typeof message.type === "string" ? message.type : "(missing)";
      const firstSeen = !this.seenMessageTypes.has(messageType);
      if (firstSeen) {
        this.seenMessageTypes.add(messageType);
      }

      switch (message.type) {
        case "session.created":
          this.sessionCreated = true;
          console.info("[transcriber] DashScope session created", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
            eventId: message.event_id ?? null,
          }));
          break;
        case "session.updated":
          console.info("[transcriber] DashScope session updated", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
            eventId: message.event_id ?? null,
            payloadPreview: firstSeen ? previewPayload(message) : undefined,
          }));
          break;
        case "session.finished":
          this.sessionFinished = true;
          this.finishAckResolve?.();
          this.finishAckResolve = null;
          console.info("[transcriber] DashScope session finished", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
            eventId: message.event_id ?? null,
            payloadPreview: previewPayload(message),
          }));
          break;
        case "input_audio_buffer.speech_started":
          console.info("[transcriber] DashScope speech started", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
            eventId: message.event_id ?? null,
            itemId: message.item_id ?? null,
          }));
          this.eventQueue.push({ type: "speech_started" });
          break;
        case "input_audio_buffer.speech_stopped":
          console.info("[transcriber] DashScope speech stopped", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
            eventId: message.event_id ?? null,
            itemId: message.item_id ?? null,
          }));
          this.eventQueue.push({ type: "speech_stopped" });
          break;
        case "conversation.item.input_audio_transcription.text":
          if (typeof message.text === "string" || typeof message.stash === "string") {
            const transcriptText = message.text ?? message.stash ?? "";
            console.info("[transcriber] DashScope transcript delta", buildDashScopeLogPayload(this.runtime, {
              url: this.url,
              eventId: message.event_id ?? null,
              itemId: message.item_id ?? null,
              textLength: transcriptText.length,
              textPreview: previewText(transcriptText),
            }));
            this.eventQueue.push({
              type: "transcript",
              text: transcriptText,
              isFinal: false,
              language: this.runtime.language,
            });
          }
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (typeof message.transcript === "string") {
            console.info("[transcriber] DashScope transcript completed", buildDashScopeLogPayload(this.runtime, {
              url: this.url,
              eventId: message.event_id ?? null,
              itemId: message.item_id ?? null,
              textLength: message.transcript.length,
              textPreview: previewText(message.transcript),
            }));
            this.eventQueue.push({
              type: "transcript",
              text: message.transcript,
              isFinal: true,
              language: this.runtime.language,
            });
          }
          break;
        case "conversation.item.input_audio_transcription.failed":
          console.error("[transcriber] DashScope transcription failed", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
            eventId: message.event_id ?? null,
            itemId: message.item_id ?? null,
            payloadPreview: previewPayload(message),
          }));
          break;
        case "error":
          console.error("[transcriber] DashScope service error", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
            eventId: message.event_id ?? null,
            payloadPreview: previewPayload(message),
          }));
          break;
        default:
          if (firstSeen) {
            console.warn("[transcriber] Unhandled DashScope message type", buildDashScopeLogPayload(this.runtime, {
              url: this.url,
              messageType,
              payloadPreview: previewPayload(message),
            }));
          }
          break;
      }
    });

    this.socket.on("error", (error) => {
      console.error("[transcriber] DashScope websocket error", {
        ...buildDashScopeLogPayload(this.runtime, {
          url: this.url,
          hint: getDashScopeConnectionHint(this.runtime, error),
        }),
        error: error instanceof Error ? error.message : error,
      });
      if (!this.open) {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.readyReject?.(failure);
        this.readyResolve = null;
        this.readyReject = null;
      }
    });

    this.socket.on("close", (code, reason) => {
      const wasOpen = this.open;
      this.open = false;
      console.warn("[transcriber] DashScope websocket closed", buildDashScopeLogPayload(this.runtime, {
        url: this.url,
        code,
        reason: reason.toString(),
        wasOpen,
        sessionCreated: this.sessionCreated,
        sessionFinished: this.sessionFinished,
        hint:
          code === 1006 || code === 1002
            ? `Unexpected websocket close. If this happens during connect, verify DASHSCOPE_REALTIME_URL (${this.runtime.baseUrl}) against the API key region.`
            : undefined,
      }));
      if (!this.closed && this.readyReject) {
        this.readyReject(new Error(`DashScope websocket closed before ready (${code}:${reason.toString()})`));
        this.readyResolve = null;
        this.readyReject = null;
      }
      this.eventQueue.close();
    });
  }

  private sendSocketMessage(payload: Record<string, unknown>, options?: { logIfSkipped?: boolean }) {
    if (!this.open || this.socket.readyState !== WebSocket.OPEN) {
      if (options?.logIfSkipped) {
        console.warn("[transcriber] Skip DashScope websocket send because socket is not open", buildDashScopeLogPayload(this.runtime, {
          url: this.url,
          payloadType: typeof payload.type === "string" ? payload.type : "(missing)",
          eventId: typeof payload.event_id === "string" ? payload.event_id : null,
          readyState: this.socket.readyState,
          open: this.open,
        }));
      }
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private sendSessionUpdate() {
    if (this.sessionUpdated) {
      return;
    }
    this.sessionUpdated = true;
    const payload = {
      event_id: `session_${Date.now()}`,
      type: "session.update",
      session: {
        modalities: ["text"],
        input_audio_format: this.runtime.inputAudioFormat,
        sample_rate: this.runtime.sampleRate,
        input_audio_transcription: {
          language: this.runtime.language,
        },
        turn_detection: this.runtime.serverVad
          ? {
              type: "server_vad",
              threshold: 0.0,
              silence_duration_ms: this.runtime.silenceDurationMs,
            }
          : null,
      },
    };
    console.info("[transcriber] Sending DashScope session.update", buildDashScopeLogPayload(this.runtime, {
      url: this.url,
      eventId: payload.event_id,
      inputAudioFormat: this.runtime.inputAudioFormat,
      silenceDurationMs: this.runtime.silenceDurationMs,
    }));
    this.sendSocketMessage(payload, { logIfSkipped: true });
  }

  private async consumeAudioStream(audioStream: AudioStream) {
    const reader = audioStream.getReader();
    const trackSid = this.trackSid;
    let frameCount = 0;
    let byteCount = 0;
    const startedAtMs = Date.now();
    console.info("[transcriber] DashScope audio stream started", buildDashScopeLogPayload(this.runtime, {
      url: this.url,
      trackSid,
    }));
    try {
      while (true) {
        const { value: frame, done } = await reader.read();
        if (done || !frame || this.closed || this.audioStream !== audioStream) {
          break;
        }

        const audio = Buffer.from(
          frame.data.buffer,
          frame.data.byteOffset,
          frame.data.byteLength,
        ).toString("base64");

        frameCount += 1;
        byteCount += frame.data.byteLength;
        this.sendSocketMessage({
          event_id: `audio_${Date.now()}`,
          type: "input_audio_buffer.append",
          audio,
        });
        if (frameCount === 1 || frameCount % AUDIO_APPEND_LOG_INTERVAL === 0) {
          console.info("[transcriber] DashScope audio appended", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
            trackSid,
            frameCount,
            byteCount,
            lastFrameBytes: frame.data.byteLength,
          }));
        }
      }
    } finally {
      reader.releaseLock();
      console.info("[transcriber] DashScope audio stream stopped", buildDashScopeLogPayload(this.runtime, {
        url: this.url,
        trackSid,
        frameCount,
        byteCount,
        durationMs: Date.now() - startedAtMs,
        closed: this.closed,
      }));
    }
  }

  async updateTrack(track: RemoteAudioTrack | null, trackSid: string | null, reason: string) {
    await this.readyPromise;
    console.info("[transcriber] DashScope update track request", buildDashScopeLogPayload(this.runtime, {
      url: this.url,
      reason,
      currentTrackSid: this.trackSid,
      nextTrackSid: trackSid,
      hasTrack: Boolean(track),
    }));

    if (this.trackSid === trackSid && this.audioStream && track) {
      console.info("[transcriber] DashScope update track skipped because track is unchanged", buildDashScopeLogPayload(this.runtime, {
        url: this.url,
        trackSid,
        reason,
      }));
      return;
    }

    const currentAudioStream = this.audioStream;
    const currentTask = this.consumeAudioTask;
    this.audioStream = null;
    this.trackSid = null;
    this.consumeAudioTask = null;

    if (currentAudioStream) {
      await currentAudioStream.cancel(reason).catch(() => undefined);
    }
    await currentTask?.catch(() => undefined);

    if (!track) {
      console.info("[transcriber] DashScope audio track detached", buildDashScopeLogPayload(this.runtime, {
        url: this.url,
        reason,
      }));
      return;
    }

    const audioStream = new AudioStream(track, {
      sampleRate: this.runtime.sampleRate,
      numChannels: 1,
    });
    this.audioStream = audioStream;
    this.trackSid = trackSid;
    this.consumeAudioTask = this.consumeAudioStream(audioStream);
    console.info("[transcriber] DashScope audio track attached", buildDashScopeLogPayload(this.runtime, {
      url: this.url,
      trackSid,
      reason,
    }));
  }

  async flush() {
    await this.readyPromise.catch(() => undefined);
    if (!this.runtime.serverVad) {
      const payload = {
        event_id: `commit_${Date.now()}`,
        type: "input_audio_buffer.commit",
      };
      console.info("[transcriber] Sending DashScope input_audio_buffer.commit", buildDashScopeLogPayload(this.runtime, {
        url: this.url,
        eventId: payload.event_id,
      }));
      this.sendSocketMessage(payload, { logIfSkipped: true });
      return;
    }
    console.info("[transcriber] Skip DashScope commit because server VAD is enabled", buildDashScopeLogPayload(this.runtime, {
      url: this.url,
    }));
  }

  private async waitForSessionFinishedAck(timeoutMs: number) {
    if (this.sessionFinished) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void this.finishAckPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    console.info("[transcriber] Closing DashScope session", buildDashScopeLogPayload(this.runtime, {
      url: this.url,
      trackSid: this.trackSid,
      sessionCreated: this.sessionCreated,
      sessionUpdated: this.sessionUpdated,
      sessionFinished: this.sessionFinished,
      socketReadyState: this.socket.readyState,
      open: this.open,
    }));
    await this.updateTrack(null, null, "provider_close").catch(() => undefined);
    await this.flush().catch(() => undefined);
    const payload = {
      event_id: `finish_${Date.now()}`,
      type: "session.finish",
    };
    console.info("[transcriber] Sending DashScope session.finish", buildDashScopeLogPayload(this.runtime, {
      url: this.url,
      eventId: payload.event_id,
    }));
    this.sendSocketMessage(payload, { logIfSkipped: true });
    const shouldWaitForFinishAck =
      this.sessionCreated &&
      !this.sessionFinished &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING);
    const finishAcknowledged = shouldWaitForFinishAck
      ? await this.waitForSessionFinishedAck(SESSION_FINISH_WAIT_TIMEOUT_MS).catch(() => false)
      : this.sessionFinished;
    console.info("[transcriber] DashScope session.finish wait completed", buildDashScopeLogPayload(this.runtime, {
      url: this.url,
      finishAcknowledged,
      waitedForAck: shouldWaitForFinishAck,
      waitTimeoutMs: SESSION_FINISH_WAIT_TIMEOUT_MS,
      sessionFinished: this.sessionFinished,
    }));
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => {
        this.socket.once("close", () => resolve());
        this.socket.close(1000, "session closed");
      }).catch(() => undefined);
    }
    this.eventQueue.close();
  }

  [Symbol.asyncIterator](): AsyncIterator<NormalizedTranscriptionEvent> {
    return this.eventQueue[Symbol.asyncIterator]();
  }
}

export const dashscopeRealtimeAdapter: RealtimeTranscriptionProviderAdapter = {
  provider: "dashscope",
  async createSession(params: CreateProviderSessionParams) {
    if (params.runtime.provider !== "dashscope" || !params.runtime.apiKey) {
      throw new Error("DashScope runtime is not configured");
    }
    return new DashScopeRealtimeSession(params.runtime);
  },
};
