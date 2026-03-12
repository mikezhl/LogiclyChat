import type { RemoteAudioTrack } from "@livekit/rtc-node";

import type { ResolvedTranscriptionRuntime } from "./runtime";

export type NormalizedTranscriptionEvent =
  | { type: "speech_started" }
  | { type: "speech_stopped" }
  | { type: "transcript"; text: string; isFinal: boolean; language?: string };

export type CreateProviderSessionParams = {
  roomId: string;
  participantIdentity: string;
  runtime: ResolvedTranscriptionRuntime;
};

export interface RealtimeTranscriptionProviderSession extends AsyncIterable<NormalizedTranscriptionEvent> {
  readonly runtime: ResolvedTranscriptionRuntime;
  updateTrack(track: RemoteAudioTrack | null, trackSid: string | null, reason: string): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface RealtimeTranscriptionProviderAdapter {
  readonly provider: ResolvedTranscriptionRuntime["provider"];
  createSession(params: CreateProviderSessionParams): Promise<RealtimeTranscriptionProviderSession>;
}
