const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

type ConversationLlmRequestErrorOptions = {
  retryable: boolean;
  status?: number | null;
  retryAfterMs?: number | null;
  requestId?: string | null;
  code?: string | null;
  cause?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveNestedErrorCode(error: Error) {
  const errorRecord = asRecord(error);
  const code = asString(errorRecord?.code);
  if (code) {
    return code;
  }

  const cause = asRecord(errorRecord?.cause);
  return asString(cause?.code);
}

function isRetryableNetworkError(error: Error) {
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return true;
  }

  const code = resolveNestedErrorCode(error);
  if (code && RETRYABLE_NETWORK_CODES.has(code)) {
    return true;
  }

  return error instanceof TypeError && error.message.toLowerCase().includes("fetch failed");
}

export class ConversationLlmRequestError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly requestId: string | null;
  readonly code: string | null;

  constructor(message: string, options: ConversationLlmRequestErrorOptions) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ConversationLlmRequestError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.requestId = options.requestId ?? null;
    this.code = options.code ?? null;
  }
}

export function normalizeConversationLlmError(error: unknown): ConversationLlmRequestError {
  if (error instanceof ConversationLlmRequestError) {
    return error;
  }

  if (error instanceof Error) {
    return new ConversationLlmRequestError(error.message, {
      retryable: isRetryableNetworkError(error),
      code: resolveNestedErrorCode(error),
      cause: error,
    });
  }

  return new ConversationLlmRequestError(String(error), {
    retryable: false,
  });
}

export function isRetryableConversationLlmStatus(status: number) {
  return RETRYABLE_HTTP_STATUSES.has(status);
}

export function parseRetryAfterMs(rawHeader: string | null) {
  const trimmed = rawHeader?.trim();
  if (!trimmed) {
    return null;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const absoluteTime = Date.parse(trimmed);
  if (Number.isNaN(absoluteTime)) {
    return null;
  }

  return Math.max(0, absoluteTime - Date.now());
}

export function extractConversationLlmRequestId(headers: Headers) {
  const knownHeaders = ["x-request-id", "request-id", "openai-request-id"];

  for (const headerName of knownHeaders) {
    const value = asString(headers.get(headerName));
    if (value) {
      return value;
    }
  }

  return null;
}
