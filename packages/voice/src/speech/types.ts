export type SttKind = "openai" | "deepgram" | "whisper-cpp";
export type TtsKind = "system" | "openai" | "elevenlabs";

export interface SttConfig {
  kind: SttKind;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  language?: string;
}

export interface TtsConfig {
  kind: TtsKind;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  description?: string;
  /** A ready-made sample some providers offer, to preview without spending characters. */
  previewUrl?: string;
}

export type SpeechErrorCode =
  | "invalid_key"
  | "rate_limited"
  | "quota_exceeded"
  | "bad_request"
  | "unavailable"
  | "network"
  | "aborted"
  | "unsupported";

const MESSAGES: Record<SpeechErrorCode, string> = {
  invalid_key: "The speech provider rejected your key. Check it in Settings → Voice mode.",
  rate_limited: "The speech provider is rate-limiting your key. Try again shortly.",
  quota_exceeded: "Your speech provider account is out of credit or over its quota.",
  bad_request: "The speech provider rejected the request.",
  unavailable: "The speech provider isn't available right now. Try again in a moment.",
  network: "Couldn't reach the speech provider. Check your connection or the server address.",
  aborted: "Stopped.",
  unsupported: "This browser can't do that.",
};

export class SpeechError extends Error {
  constructor(
    readonly code: SpeechErrorCode,
    message = MESSAGES[code],
    readonly status?: number,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}

export async function speechErrorFrom(res: Response): Promise<SpeechError> {
  let detail = "";
  try {
    const body = (await res.json()) as {
      error?: { message?: string } | string;
      detail?: unknown;
      message?: string;
    };
    detail =
      typeof body.error === "string"
        ? body.error
        : (body.error?.message ?? (typeof body.detail === "string" ? body.detail : (body.message ?? "")));
  } catch {
    /* not JSON */
  }
  const text = detail.toLowerCase();
  const code: SpeechErrorCode =
    res.status === 401 || res.status === 403
      ? "invalid_key"
      : res.status === 402 || /quota|credit|billing/.test(text)
        ? "quota_exceeded"
        : res.status === 429
          ? "rate_limited"
          : res.status >= 500
            ? "unavailable"
            : "bad_request";
  const base = MESSAGES[code];
  return new SpeechError(code, code === "bad_request" && detail ? `${base} ${detail}` : base, res.status);
}

export function networkError(err: unknown): SpeechError {
  if ((err as { name?: string })?.name === "AbortError") return new SpeechError("aborted");
  if (err instanceof SpeechError) return err;
  return new SpeechError("network");
}
