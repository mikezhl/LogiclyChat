import { isTranscriberEnabled } from "@/features/transcription/service/livekit-dispatch";
import { getConversationAnalysisPromptProfiles } from "@/features/analysis/llm/core";
import type { ResolvedConversationLlmRuntime, RuntimeSource } from "./llm-provider-keys";
import type { KeySource, ResolvedProviderCredentials } from "./provider-keys";

export type ProviderOwnerKind = "platform" | "user" | "builtin" | "unavailable";

export type ProviderOwner = {
  kind: ProviderOwnerKind;
  username: string | null;
};

export type VoiceProviderModule = {
  providedBy: ProviderOwner;
  transportProvider: string;
  transportSource: KeySource;
  transportCredentialMask: string | null;
  transportReady: boolean;
  transcriptionEnabled: boolean;
  transcriptionProvider: string | null;
  transcriptionSource: KeySource;
  transcriptionCredentialMask: string | null;
  transcriptionReady: boolean;
};

export type AnalysisProviderModule = {
  providedBy: ProviderOwner;
  provider: string;
  source: RuntimeSource;
  credentialMask: string | null;
  model: string | null;
  ready: boolean;
  profiles: {
    realtime: string;
    summary: string;
  };
};

export type RoomProviderModules = {
  voice: VoiceProviderModule;
  analysis: AnalysisProviderModule;
};

function getVoiceTransportProviderName() {
  return "livekit";
}

function getTranscriptionProviderName(enabled: boolean) {
  return enabled ? "deepgram" : null;
}

function resolveProviderOwnerFromSource(
  source: KeySource | RuntimeSource,
  ownerUsername: string | null,
): ProviderOwner {
  if (source === "user") {
    return {
      kind: "user",
      username: ownerUsername,
    };
  }
  if (source === "system") {
    return {
      kind: "platform",
      username: null,
    };
  }
  if (source === "builtin") {
    return {
      kind: "builtin",
      username: null,
    };
  }

  return {
    kind: "unavailable",
    username: null,
  };
}

export function buildRoomProviderModules(
  voiceCredentials: ResolvedProviderCredentials,
  llmRuntime: ResolvedConversationLlmRuntime,
  ownerUsername: string | null,
): RoomProviderModules {
  const transcriptionEnabled = isTranscriberEnabled();
  const profiles = getConversationAnalysisPromptProfiles();

  return {
    voice: {
      providedBy: resolveProviderOwnerFromSource(voiceCredentials.livekitSource, ownerUsername),
      transportProvider: getVoiceTransportProviderName(),
      transportSource: voiceCredentials.livekitSource,
      transportCredentialMask: voiceCredentials.livekitApiKeyMask,
      transportReady: Boolean(
        voiceCredentials.livekitUrl &&
          voiceCredentials.livekitApiKey &&
          voiceCredentials.livekitApiSecret,
      ),
      transcriptionEnabled,
      transcriptionProvider: getTranscriptionProviderName(transcriptionEnabled),
      transcriptionSource: transcriptionEnabled ? voiceCredentials.deepgramSource : "unavailable",
      transcriptionCredentialMask: transcriptionEnabled ? voiceCredentials.deepgramApiKeyMask : null,
      transcriptionReady: transcriptionEnabled ? Boolean(voiceCredentials.deepgramApiKey) : false,
    },
    analysis: {
      providedBy: resolveProviderOwnerFromSource(llmRuntime.source, ownerUsername),
      provider: llmRuntime.provider,
      source: llmRuntime.source,
      credentialMask: llmRuntime.apiKeyMask,
      model: llmRuntime.model,
      ready: llmRuntime.configured,
      profiles,
    },
  };
}
