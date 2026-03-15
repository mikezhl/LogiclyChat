import * as deepgram from "@livekit/agents-plugin-deepgram";
import { stt } from "@livekit/agents";
import { AudioStream, type RemoteAudioTrack } from "@livekit/rtc-node";

import { AsyncEventQueue } from "@/features/transcription/core/async-event-queue";
import type {
  CreateProviderSessionParams,
  NormalizedTranscriptionEvent,
  RealtimeTranscriptionProviderAdapter,
  RealtimeTranscriptionProviderSession,
} from "@/features/transcription/core/session";
import type { DeepgramTranscriptionRuntime } from "@/features/transcription/core/runtime";

class DeepgramRealtimeSession implements RealtimeTranscriptionProviderSession {
  readonly runtime: DeepgramTranscriptionRuntime;

  private readonly speechStream: stt.SpeechStream;
  private readonly sttProvider: deepgram.STT;
  private readonly eventQueue = new AsyncEventQueue<NormalizedTranscriptionEvent>();
  private audioStream: AudioStream | null = null;
  private trackSid: string | null = null;
  private closed = false;
  private readonly consumeTask: Promise<void>;

  constructor(runtime: DeepgramTranscriptionRuntime) {
    this.runtime = runtime;
    const options: deepgram.STTOptions = {
      apiKey: runtime.apiKey!,
      model: runtime.model as deepgram.STTOptions["model"],
      language: runtime.language,
      interimResults: runtime.interimResults,
      punctuate: runtime.punctuate,
      smartFormat: runtime.smartFormat,
      endpointing: runtime.endpointing,
      profanityFilter: runtime.profanityFilter,
      fillerWords: runtime.fillerWords,
      numerals: runtime.numerals,
      detectLanguage: runtime.detectLanguage,
      noDelay: runtime.noDelay,
      diarize: runtime.diarize,
      dictation: runtime.dictation,
      sampleRate: runtime.sampleRate,
      numChannels: runtime.numChannels,
      keywords: [],
      keyterm: [],
      mipOptOut: runtime.mipOptOut,
    };

    this.sttProvider = new deepgram.STT(options);
    this.speechStream = this.sttProvider.stream();

    this.sttProvider.on("error", (event) => {
      console.error("[transcriber] Deepgram transcription stream error", {
        recoverable: event.recoverable,
        error: event.error instanceof Error ? event.error.message : event.error,
      });
    });

    this.consumeTask = this.consumeSpeechStream();
  }

  private async consumeSpeechStream() {
    try {
      for await (const event of this.speechStream) {
        if (this.closed) {
          break;
        }

        switch (event.type) {
          case stt.SpeechEventType.START_OF_SPEECH:
            this.eventQueue.push({ type: "speech_started" });
            break;
          case stt.SpeechEventType.END_OF_SPEECH:
            this.eventQueue.push({ type: "speech_stopped" });
            break;
          case stt.SpeechEventType.INTERIM_TRANSCRIPT:
          case stt.SpeechEventType.FINAL_TRANSCRIPT: {
            const alternative = event.alternatives?.[0];
            if (!alternative?.text) {
              break;
            }
            this.eventQueue.push({
              type: "transcript",
              text: alternative.text,
              isFinal: event.type === stt.SpeechEventType.FINAL_TRANSCRIPT,
              language: alternative.language,
            });
            break;
          }
        }
      }
    } finally {
      this.eventQueue.close();
    }
  }

  async updateTrack(track: RemoteAudioTrack | null, trackSid: string | null, reason: string) {
    if (this.trackSid === trackSid && this.audioStream && track) {
      return;
    }

    const currentAudioStream = this.audioStream;
    this.audioStream = null;
    this.trackSid = null;

    if (currentAudioStream) {
      try {
        this.speechStream.detachInputStream();
      } catch {
        // ignore detach races
      }
      await currentAudioStream.cancel(reason).catch(() => undefined);
    }

    if (!track) {
      return;
    }

    const audioStream = new AudioStream(track, {
      sampleRate: this.runtime.sampleRate,
      numChannels: this.runtime.numChannels,
    });
    this.speechStream.updateInputStream(
      audioStream as unknown as Parameters<stt.SpeechStream["updateInputStream"]>[0],
    );

    this.audioStream = audioStream;
    this.trackSid = trackSid;
  }

  async flush() {
    // Deepgram VAD/endpointing already finalizes utterances on its own.
    // The current LiveKit plugin may emit a zero-sample frame on flush,
    // which breaks the stream and forces a costly reconnect loop.
    return;
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.updateTrack(null, null, "provider_close");
    try {
      this.speechStream.close();
    } catch {
      // ignore close races
    }
    await this.consumeTask.catch(() => undefined);
    await this.sttProvider.close().catch(() => undefined);
    this.eventQueue.close();
  }

  [Symbol.asyncIterator](): AsyncIterator<NormalizedTranscriptionEvent> {
    return this.eventQueue[Symbol.asyncIterator]();
  }
}

export const deepgramRealtimeAdapter: RealtimeTranscriptionProviderAdapter = {
  provider: "deepgram",
  async createSession(params: CreateProviderSessionParams) {
    if (params.runtime.provider !== "deepgram" || !params.runtime.apiKey) {
      throw new Error("Deepgram runtime is not configured");
    }
    return new DeepgramRealtimeSession(params.runtime);
  },
};
