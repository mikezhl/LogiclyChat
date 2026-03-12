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
};

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

class DashScopeRealtimeSession implements RealtimeTranscriptionProviderSession {
  readonly runtime: DashScopeTranscriptionRuntime;

  private readonly eventQueue = new AsyncEventQueue<NormalizedTranscriptionEvent>();
  private readonly url: string;
  private readonly socket: WebSocket;
  private readonly readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private audioStream: AudioStream | null = null;
  private trackSid: string | null = null;
  private consumeAudioTask: Promise<void> | null = null;
  private closed = false;
  private open = false;
  private sessionUpdated = false;

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
        return;
      }

      switch (message.type) {
        case "session.created":
          console.info("[transcriber] DashScope session created", buildDashScopeLogPayload(this.runtime, {
            url: this.url,
          }));
          break;
        case "input_audio_buffer.speech_started":
          this.eventQueue.push({ type: "speech_started" });
          break;
        case "input_audio_buffer.speech_stopped":
          this.eventQueue.push({ type: "speech_stopped" });
          break;
        case "conversation.item.input_audio_transcription.text":
          if (typeof message.text === "string" || typeof message.stash === "string") {
            this.eventQueue.push({
              type: "transcript",
              text: message.text ?? message.stash ?? "",
              isFinal: false,
              language: this.runtime.language,
            });
          }
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (typeof message.transcript === "string") {
            this.eventQueue.push({
              type: "transcript",
              text: message.transcript,
              isFinal: true,
              language: this.runtime.language,
            });
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

  private sendSocketMessage(payload: Record<string, unknown>) {
    if (!this.open || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private sendSessionUpdate() {
    if (this.sessionUpdated) {
      return;
    }
    this.sessionUpdated = true;
    this.sendSocketMessage({
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
    });
  }

  private async consumeAudioStream(audioStream: AudioStream) {
    const reader = audioStream.getReader();
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

        this.sendSocketMessage({
          event_id: `audio_${Date.now()}`,
          type: "input_audio_buffer.append",
          audio,
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  async updateTrack(track: RemoteAudioTrack | null, trackSid: string | null, reason: string) {
    await this.readyPromise;

    if (this.trackSid === trackSid && this.audioStream && track) {
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
      return;
    }

    const audioStream = new AudioStream(track, {
      sampleRate: this.runtime.sampleRate,
      numChannels: 1,
    });
    this.audioStream = audioStream;
    this.trackSid = trackSid;
    this.consumeAudioTask = this.consumeAudioStream(audioStream);
  }

  async flush() {
    await this.readyPromise.catch(() => undefined);
    if (!this.runtime.serverVad) {
      this.sendSocketMessage({
        event_id: `commit_${Date.now()}`,
        type: "input_audio_buffer.commit",
      });
    }
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.updateTrack(null, null, "provider_close").catch(() => undefined);
    await this.flush().catch(() => undefined);
    this.sendSocketMessage({
      event_id: `finish_${Date.now()}`,
      type: "session.finish",
    });
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
