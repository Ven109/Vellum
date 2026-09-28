/**
 * The provider abstraction. A backend is a small adapter implementing {@link ProviderAdapter}; the rest
 * of Vellum only speaks these types. There is no hosted inference: every call goes from the user's
 * device (or their self-hosted server) straight to the provider they configured with their own key.
 */
export type ProviderKind = "anthropic" | "openai" | "openai-compatible" | "ollama";

export interface ProviderConfig {
  /** Stable id for this configured provider, e.g. "anthropic" or "prv_…" for custom endpoints. */
  id: string;
  kind: ProviderKind;
  label: string;
  /** Required for openai-compatible and ollama; optional override for the others. */
  baseUrl?: string;
  /** The user's key. Never logged or sent anywhere but `baseUrl`. Optional for local runtimes. */
  apiKey?: string;
  defaultModel: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = "end_turn" | "max_tokens" | "stop" | "refusal" | "aborted" | "unknown";

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "usage"; usage: Partial<Usage> }
  | { type: "done"; stopReason: StopReason; model: string };

export interface ChatResult {
  text: string;
  usage: Usage;
  stopReason: StopReason;
  model: string;
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  /** Whether this provider needs a key at all (local runtimes do not). */
  readonly requiresKey: boolean;
  readonly defaultBaseUrl: string;
  listModels(config: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]>;
  stream(config: ProviderConfig, request: ChatRequest): AsyncIterable<ChatEvent>;
  /** Exact where the provider offers an endpoint, estimated otherwise. */
  countTokens(config: ProviderConfig, request: ChatRequest): Promise<{ tokens: number; exact: boolean }>;
}

export type ProviderErrorCode =
  | "invalid_key"
  | "permission"
  | "rate_limited"
  | "quota_exceeded"
  | "model_not_found"
  | "context_too_long"
  | "bad_request"
  | "overloaded"
  | "server"
  | "network"
  | "aborted"
  | "refused"
  | "unknown";

/** A provider failure normalised across backends so the UI can say something specific and honest. */
export class ProviderError extends Error {
  override name = "ProviderError";
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly opts: { status?: number; retryAfterMs?: number; providerMessage?: string } = {},
  ) {
    super(message);
  }

  get retryable(): boolean {
    return ["rate_limited", "overloaded", "server", "network"].includes(this.code);
  }
}
