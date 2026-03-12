import type { ResolvedTranscriptionRuntime } from "./runtime";
import type { RealtimeTranscriptionProviderAdapter } from "./session";
import { deepgramRealtimeAdapter } from "../providers/deepgram/adapter";
import { dashscopeRealtimeAdapter } from "../providers/dashscope/adapter";

const registry = new Map<ResolvedTranscriptionRuntime["provider"], RealtimeTranscriptionProviderAdapter>([
  [deepgramRealtimeAdapter.provider, deepgramRealtimeAdapter],
  [dashscopeRealtimeAdapter.provider, dashscopeRealtimeAdapter],
]);

export function getRealtimeTranscriptionProviderAdapter(provider: ResolvedTranscriptionRuntime["provider"]) {
  const adapter = registry.get(provider);
  if (!adapter) {
    throw new Error(`Unsupported transcription provider: ${provider}`);
  }
  return adapter;
}
