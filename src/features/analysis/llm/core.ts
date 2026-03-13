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
  ConversationLlmInvocationResult,
  RealtimeConversationInput,
  SummaryConversationInput,
} from "./types";
import { normalizeConversationLlmError } from "./errors";

const providerRegistry: Record<ConversationLlmProviderName, ConversationLlmProvider> = {
  mock: new MockConversationLlmProvider(),
  "openai-compatible": new OpenAiCompatibleConversationLlmProvider(),
};
const REALTIME_RETRY_DELAYS_MS = [1000, 2000];
const SUMMARY_RETRY_DELAYS_MS = [1000, 2000, 5000];

function getRealtimePromptStyle() {
  return process.env.CONVERSATION_REALTIME_PROMPT_STYLE ?? "default_cn";
}

function getSummaryPromptStyle() {
  return process.env.CONVERSATION_SUMMARY_PROMPT_STYLE ?? "default_cn";
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

function buildFallbackConversationContent(
  mode: "realtime" | "summary",
  errorMessage: string,
): ConversationLlmJson {
  if (mode === "realtime") {
    return {
      type: "realtime-analysis",
      focus: "",
      insights: [],
      suggestions: [],
      error: errorMessage,
    };
  }

  return {
    type: "final-summary",
    focus: "",
    insights: [],
    overall: "",
    side_a_points: [],
    side_b_points: [],
    open_questions: [],
    next_steps: [],
    error: errorMessage,
  };
}

function getRetryDelays(mode: "realtime" | "summary") {
  return mode === "realtime" ? REALTIME_RETRY_DELAYS_MS : SUMMARY_RETRY_DELAYS_MS;
}

function buildFallbackResult(
  mode: "realtime" | "summary",
  source: ConversationLlmInvocationResult["source"],
  errorMessage: string,
): ConversationLlmInvocationResult {
  return {
    content: buildFallbackConversationContent(mode, errorMessage),
    usage: null,
    source,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function invokeWithRetries(
  mode: "realtime" | "summary",
  provider: ConversationLlmProvider,
  invocation: Parameters<ConversationLlmProvider["invoke"]>[0],
  source: ConversationLlmInvocationResult["source"],
): Promise<ConversationLlmInvocationResult> {
  const retryDelays = getRetryDelays(mode);
  let lastErrorMessage = "Unknown LLM error";

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const result = await provider.invoke(invocation);
      return {
        ...result,
        source,
      };
    } catch (error) {
      const normalizedError = normalizeConversationLlmError(error);
      lastErrorMessage = normalizedError.message;

      const isLastAttempt = attempt === retryDelays.length;
      if (!normalizedError.retryable || isLastAttempt) {
        console.error("[conversation-llm] Falling back to empty output", {
          mode,
          attempt: attempt + 1,
          retryable: normalizedError.retryable,
          status: normalizedError.status,
          requestId: normalizedError.requestId,
          error: normalizedError.message,
        });

        return buildFallbackResult(mode, source, lastErrorMessage);
      }

      const retryInMs = retryDelays[attempt];
      console.warn("[conversation-llm] Retrying failed request", {
        mode,
        attempt: attempt + 1,
        retryInMs,
        status: normalizedError.status,
        requestId: normalizedError.requestId,
        error: normalizedError.message,
      });
      await delay(retryInMs);
    }
  }

  return buildFallbackResult(mode, source, lastErrorMessage);
}

export async function invokeRealtimeConversationAnalysis(
  input: RealtimeConversationInput,
  ownerUserId?: string | null,
): Promise<ConversationLlmInvocationResult> {
  const promptResolution = resolvePromptTemplate("realtime", getRealtimePromptStyle());
  let source: ConversationLlmInvocationResult["source"] = "unavailable";

  try {
    const runtime = await resolveConversationLlmRuntimeForOwner(ownerUserId);
    source = runtime.source;
    const provider = getProvider(runtime.provider);

    return await invokeWithRetries(
      "realtime",
      provider,
      {
        mode: "realtime",
        style: promptResolution.style,
        prompt: promptResolution.prompt,
        input,
        runtime,
      },
      source,
    );
  } catch (error) {
    const normalizedError = normalizeConversationLlmError(error);

    console.error("[conversation-llm] Falling back to empty output", {
      mode: "realtime",
      stage: "runtime",
      error: normalizedError.message,
    });

    return buildFallbackResult("realtime", source, normalizedError.message);
  }
}

export async function invokeConversationSummary(
  input: SummaryConversationInput,
  ownerUserId?: string | null,
): Promise<ConversationLlmInvocationResult> {
  const promptResolution = resolvePromptTemplate("summary", getSummaryPromptStyle());
  let source: ConversationLlmInvocationResult["source"] = "unavailable";

  try {
    const runtime = await resolveConversationLlmRuntimeForOwner(ownerUserId);
    source = runtime.source;
    const provider = getProvider(runtime.provider);

    return await invokeWithRetries(
      "summary",
      provider,
      {
        mode: "summary",
        style: promptResolution.style,
        prompt: promptResolution.prompt,
        input,
        runtime,
      },
      source,
    );
  } catch (error) {
    const normalizedError = normalizeConversationLlmError(error);

    console.error("[conversation-llm] Falling back to empty output", {
      mode: "summary",
      stage: "runtime",
      error: normalizedError.message,
    });

    return buildFallbackResult("summary", source, normalizedError.message);
  }
}
