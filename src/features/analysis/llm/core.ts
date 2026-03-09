import {
  type ConversationLlmProviderName,
  resolveConversationLlmRuntimeForOwner,
} from "@/lib/llm-provider-keys";
import { MockConversationLlmProvider } from "./mock-llm";
import { OpenAiCompatibleConversationLlmProvider } from "./openai-compatible-llm";
import { resolvePromptTemplate } from "./prompts";
import {
  ConversationLlmProvider,
  ConversationLlmJson,
  RealtimeConversationInput,
  SummaryConversationInput,
} from "./types";

const providerRegistry: Record<ConversationLlmProviderName, ConversationLlmProvider> = {
  mock: new MockConversationLlmProvider(),
  "openai-compatible": new OpenAiCompatibleConversationLlmProvider(),
};

function getRealtimePromptStyle() {
  return process.env.CONVERSATION_REALTIME_PROMPT_STYLE ?? "default";
}

function getSummaryPromptStyle() {
  return process.env.CONVERSATION_SUMMARY_PROMPT_STYLE ?? "default";
}

export function getConversationAnalysisPromptProfiles() {
  return {
    realtime: resolvePromptTemplate("realtime", getRealtimePromptStyle()).style,
    summary: resolvePromptTemplate("summary", getSummaryPromptStyle()).style,
  };
}

function getProvider(providerName: ConversationLlmProviderName): ConversationLlmProvider {
  return providerRegistry[providerName];
}

export async function invokeRealtimeConversationAnalysis(
  input: RealtimeConversationInput,
  ownerUserId?: string | null,
): Promise<ConversationLlmJson> {
  const promptResolution = resolvePromptTemplate("realtime", getRealtimePromptStyle());
  const runtime = await resolveConversationLlmRuntimeForOwner(ownerUserId);
  const provider = getProvider(runtime.provider);

  return provider.invoke({
    mode: "realtime",
    style: promptResolution.style,
    prompt: promptResolution.prompt,
    input,
    runtime,
  });
}

export async function invokeConversationSummary(
  input: SummaryConversationInput,
  ownerUserId?: string | null,
): Promise<ConversationLlmJson> {
  const promptResolution = resolvePromptTemplate("summary", getSummaryPromptStyle());
  const runtime = await resolveConversationLlmRuntimeForOwner(ownerUserId);
  const provider = getProvider(runtime.provider);

  return provider.invoke({
    mode: "summary",
    style: promptResolution.style,
    prompt: promptResolution.prompt,
    input,
    runtime,
  });
}
