import {
  ConversationLlmInvocation,
  ConversationLlmProvider,
  ConversationLlmProviderResult,
} from "./types";
import {
  ConversationLlmRequestError,
  extractConversationLlmRequestId,
  isRetryableConversationLlmStatus,
  normalizeConversationLlmError,
  parseRetryAfterMs,
} from "./errors";

type OpenAiCompatibleResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

type OpenAiCompatibleMessageContent =
  | string
  | Array<{
      type?: string;
      text?: string;
    }>
  | undefined;

function normalizeChatCompletionsPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  if (/\/v\d+$/i.test(normalized)) {
    return `${normalized}/chat/completions`;
  }
  if (!normalized || normalized === "/") {
    return "/v1/chat/completions";
  }
  return `${normalized}/v1/chat/completions`;
}

function resolveChatCompletionsUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  url.pathname = normalizeChatCompletionsPath(url.pathname);
  return url.toString();
}

function buildUserMessage(invocation: ConversationLlmInvocation) {
  return JSON.stringify(
    {
      mode: invocation.mode,
      style: invocation.style,
      input: invocation.input,
    },
    null,
    2,
  );
}

function extractContentText(content: OpenAiCompatibleMessageContent) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  }

  return "";
}

function normalizeJsonPayload(rawContent: string) {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function normalizeUsage(
  usage: OpenAiCompatibleResponse["usage"] | undefined,
): ConversationLlmProviderResult["usage"] {
  if (!usage) {
    return null;
  }

  return {
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens:
      typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as OpenAiCompatibleResponse;
    return payload.error?.message ?? `${response.status} ${response.statusText}`;
  } catch {
    const text = await response.text().catch(() => "");
    return text || `${response.status} ${response.statusText}`;
  }
}

export class OpenAiCompatibleConversationLlmProvider implements ConversationLlmProvider {
  async invoke(invocation: ConversationLlmInvocation): Promise<ConversationLlmProviderResult> {
    const { runtime } = invocation;
    if (!runtime.baseUrl || !runtime.apiKey || !runtime.model) {
      throw new ConversationLlmRequestError(
        "OpenAI-compatible LLM requires baseUrl, apiKey and model from room owner or platform env",
        {
          retryable: false,
          code: "LLM_RUNTIME_INCOMPLETE",
        },
      );
    }

    const requestUrl = resolveChatCompletionsUrl(runtime.baseUrl);
    let response: Response;

    try {
      response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${runtime.apiKey}`,
        },
        body: JSON.stringify({
          model: runtime.model,
          messages: [
            {
              role: "system",
              content: invocation.prompt,
            },
            {
              role: "user",
              content: buildUserMessage(invocation),
            },
          ],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw normalizeConversationLlmError(error);
    }

    if (!response.ok) {
      const requestId = extractConversationLlmRequestId(response.headers);
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const providerMessage = await readErrorMessage(response);
      const statusMessage = `${response.status} ${response.statusText}`.trim();
      const message = providerMessage
        ? `OpenAI-compatible LLM request failed (${statusMessage}): ${providerMessage}`
        : `OpenAI-compatible LLM request failed (${statusMessage})`;

      throw new ConversationLlmRequestError(message, {
        retryable: isRetryableConversationLlmStatus(response.status),
        status: response.status,
        retryAfterMs,
        requestId,
      });
    }

    let payload: OpenAiCompatibleResponse;
    try {
      payload = (await response.json()) as OpenAiCompatibleResponse;
    } catch (error) {
      throw new ConversationLlmRequestError(
        "OpenAI-compatible LLM returned invalid JSON payload",
        {
          retryable: false,
          code: "LLM_RESPONSE_INVALID_JSON",
          cause: error,
        },
      );
    }

    const content = extractContentText(payload.choices?.[0]?.message?.content);
    if (!content) {
      throw new ConversationLlmRequestError(
        "OpenAI-compatible LLM returned empty message content",
        {
          retryable: false,
          code: "LLM_RESPONSE_EMPTY_CONTENT",
        },
      );
    }

    try {
      return {
        content: JSON.parse(normalizeJsonPayload(content)) as Record<string, unknown>,
        usage: normalizeUsage(payload.usage),
      };
    } catch (error) {
      throw new ConversationLlmRequestError(
        `OpenAI-compatible LLM returned non-JSON content: ${
          error instanceof Error ? error.message : "unknown parse error"
        }`,
        {
          retryable: false,
          code: "LLM_CONTENT_NON_JSON",
          cause: error,
        },
      );
    }
  }
}
