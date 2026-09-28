import { ProviderError } from "./types.js";
import type { ProviderErrorCode } from "./types.js";

function retryAfter(
  headers?: Headers | Record<string, string | null | undefined> | null,
): number | undefined {
  if (!headers) return undefined;
  const raw = headers instanceof Headers ? headers.get("retry-after") : headers["retry-after"];
  if (!raw) return undefined;
  const secs = Number(raw);
  if (!Number.isNaN(secs)) return secs * 1000;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const HUMAN: Record<ProviderErrorCode, string> = {
  invalid_key: "The provider rejected your API key. Check it in Settings → AI provider.",
  permission: "Your key does not have access to this model or feature.",
  rate_limited: "The provider is rate-limiting requests from your key. Try again shortly.",
  quota_exceeded: "Your provider account is out of credit or over its quota.",
  model_not_found: "That model isn't available to your key. Pick another model in Settings.",
  context_too_long: "The request is too long for this model's context window. Try a smaller selection.",
  bad_request: "The provider rejected the request.",
  overloaded: "The provider is overloaded right now. Try again in a moment.",
  server: "The provider had an internal error. Try again.",
  network: "Couldn't reach the provider. Check your connection or the endpoint URL.",
  aborted: "Stopped.",
  refused: "The model declined this request.",
  unknown: "Something went wrong talking to the provider.",
};

export function humanMessage(code: ProviderErrorCode): string {
  return HUMAN[code];
}

/**
 * Map an HTTP status plus the provider's error body to a normalised error. Body shapes differ:
 * Anthropic `{error:{type,message}}`, OpenAI `{error:{code,type,message}}`, Ollama `{error:"..."}`.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  headers?: Headers | Record<string, string | null | undefined> | null,
): ProviderError {
  const err = (body as { error?: unknown } | null)?.error;
  const providerMessage =
    typeof err === "string"
      ? err
      : typeof (err as { message?: unknown })?.message === "string"
        ? (err as { message: string }).message
        : undefined;
  const type = String(
    (err as { type?: unknown; code?: unknown })?.code ?? (err as { type?: unknown })?.type ?? "",
  );
  const text = `${type} ${providerMessage ?? ""}`.toLowerCase();

  let code: ProviderErrorCode;
  if (status === 401) code = "invalid_key";
  else if (status === 402 || /insufficient_quota|billing|credit balance|quota/.test(text))
    code = "quota_exceeded";
  else if (status === 403) code = "permission";
  else if (status === 404 || /model_not_found|model.*not.*found|does not exist/.test(text))
    code = "model_not_found";
  else if (status === 429) code = "rate_limited";
  else if (status === 413 || /context|too long|maximum.*tokens|prompt is too long/.test(text))
    code = "context_too_long";
  else if (status === 529 || /overloaded/.test(text)) code = "overloaded";
  else if (status >= 500) code = "server";
  else if (status === 400) code = "bad_request";
  else code = "unknown";

  return new ProviderError(code, HUMAN[code], { status, retryAfterMs: retryAfter(headers), providerMessage });
}

export function errorFromThrown(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if ((e as { name?: string })?.name === "AbortError") return new ProviderError("aborted", HUMAN.aborted);
  return new ProviderError("network", HUMAN.network, { providerMessage: (e as Error)?.message });
}
