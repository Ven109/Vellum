import { SAMPLE_RATE, encodeWav } from "../pcm.js";
import { VoiceTransport } from "../transport.js";
import type { SocketFactory } from "../transport.js";
import { SpeechError, networkError, speechErrorFrom } from "./types.js";
import type { SttConfig, SttKind } from "./types.js";

export interface SttPreset {
  kind: SttKind;
  label: string;
  description: string;
  needsKey: boolean;
  needsBaseUrl: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  keyUrl?: string;
  /** Streaming providers transcribe while you speak; the others after each turn. */
  streaming: boolean;
  /** Audio never leaves your machine. */
  local: boolean;
}

export const STT_PRESETS: SttPreset[] = [
  {
    kind: "openai",
    label: "OpenAI (Whisper)",
    description: "Accurate transcription of each turn with your OpenAI key.",
    needsKey: true,
    needsBaseUrl: false,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini-transcribe",
    keyUrl: "https://platform.openai.com/api-keys",
    streaming: false,
    local: false,
  },
  {
    kind: "deepgram",
    label: "Deepgram",
    description: "Streaming transcription: words appear while you speak.",
    needsKey: true,
    needsBaseUrl: false,
    defaultBaseUrl: "wss://api.deepgram.com/v1/listen",
    defaultModel: "nova-3",
    keyUrl: "https://console.deepgram.com/",
    streaming: true,
    local: false,
  },
  {
    kind: "whisper-cpp",
    label: "whisper.cpp (local)",
    description: "Runs on your own machine with whisper.cpp's server. Audio never leaves it.",
    needsKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: "http://127.0.0.1:8080",
    defaultModel: "",
    streaming: false,
    local: true,
  },
];

export const sttPreset = (kind: SttKind) => STT_PRESETS.find((p) => p.kind === kind)!;

export interface RecognizerHandlers {
  /** Words so far in the current turn (streaming providers only). */
  onInterim?: (text: string) => void;
  onError?: (err: SpeechError) => void;
}

/** Turns audio frames into text, one turn at a time. */
export interface Recognizer {
  readonly streaming: boolean;
  /** Feed every 20 ms frame. Frames outside speech are used for pre-roll only. */
  push(pcm: Int16Array, speaking: boolean): void;
  /** The speaker finished: resolve with the whole turn's text. */
  endTurn(): Promise<string>;
  /** Drop the current turn without transcribing it. */
  cancelTurn(): void;
  close(): void;
}

export interface RecognizerDeps {
  fetch?: typeof fetch;
  createSocket?: SocketFactory;
}

const PRE_ROLL_FRAMES = 15; // 300 ms before speech was detected, so first syllables aren't clipped

/** Request/response providers: collect the turn's audio, send it as WAV when the turn ends. */
class UtteranceRecognizer implements Recognizer {
  readonly streaming = false;
  private preRoll: Int16Array[] = [];
  private turn: Int16Array[] = [];
  private inTurn = false;
  private controller: AbortController | null = null;

  constructor(
    private readonly transcribe: (wav: Uint8Array, signal: AbortSignal) => Promise<string>,
    private readonly handlers: RecognizerHandlers,
  ) {}

  push(pcm: Int16Array, speaking: boolean) {
    if (speaking && !this.inTurn) {
      this.inTurn = true;
      this.turn = [...this.preRoll];
    }
    if (this.inTurn) this.turn.push(pcm);
    else {
      this.preRoll.push(pcm);
      if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
    }
  }

  async endTurn(): Promise<string> {
    const frames = this.turn;
    this.turn = [];
    this.inTurn = false;
    this.preRoll = [];
    if (!frames.length) return "";
    const pcm = new Int16Array(frames.reduce((n, f) => n + f.length, 0));
    let at = 0;
    for (const f of frames) {
      pcm.set(f, at);
      at += f.length;
    }
    this.controller = new AbortController();
    try {
      return (await this.transcribe(encodeWav(pcm, SAMPLE_RATE), this.controller.signal)).trim();
    } catch (e) {
      const err = networkError(e);
      this.handlers.onError?.(err);
      throw err;
    } finally {
      this.controller = null;
    }
  }

  cancelTurn() {
    this.turn = [];
    this.inTurn = false;
    this.controller?.abort();
  }

  close() {
    this.cancelTurn();
  }
}

async function postWav(
  f: typeof fetch,
  url: string,
  wav: Uint8Array,
  fields: Record<string, string>,
  fileField: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const form = new FormData();
  form.append(fileField, new Blob([wav as BlobPart], { type: "audio/wav" }), "turn.wav");
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
  let res: Response;
  try {
    res = await f(url, { method: "POST", body: form, headers, signal });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) throw await speechErrorFrom(res);
  return res.json();
}

/** Deepgram's live API: audio streams up, interim and final results stream down. */
class DeepgramRecognizer implements Recognizer {
  readonly streaming = true;
  private transport: VoiceTransport;
  private finals: string[] = [];
  private interim = "";
  private waiting: { resolve: (s: string) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private preRoll: Int16Array[] = [];
  private inTurn = false;

  constructor(
    config: SttConfig,
    private readonly handlers: RecognizerHandlers,
    createSocket?: SocketFactory,
  ) {
    const p = sttPreset("deepgram");
    const params = new URLSearchParams({
      encoding: "linear16",
      sample_rate: String(SAMPLE_RATE),
      channels: "1",
      model: config.model || p.defaultModel,
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      // Our own VAD decides turn ends; Deepgram shouldn't wait on its own endpointing.
      endpointing: "false",
    });
    if (config.language) params.set("language", config.language);
    this.transport = new VoiceTransport({
      url: `${config.baseUrl || p.defaultBaseUrl}?${params}`,
      protocols: ["token", config.apiKey ?? ""],
      keepAlive: { everyMs: 5000, message: { type: "KeepAlive" } },
      ...(createSocket ? { createSocket } : {}),
    });
    this.transport.on("message", (m) => this.onMessage(m));
    this.transport.on("state", (s) => {
      if (s === "closed" && this.waiting) this.finish();
    });
    this.transport.connect();
  }

  private onMessage(m: unknown) {
    const msg = m as {
      type?: string;
      is_final?: boolean;
      from_finalize?: boolean;
      channel?: { alternatives?: Array<{ transcript?: string }> };
      err_msg?: string;
    };
    if (msg.type === "Results") {
      const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
      if (msg.is_final) {
        if (text) this.finals.push(text);
        this.interim = "";
      } else this.interim = text;
      this.handlers.onInterim?.([...this.finals, this.interim].filter(Boolean).join(" "));
      if (msg.is_final && msg.from_finalize && this.waiting) this.finish();
    } else if (msg.type === "Error") {
      this.handlers.onError?.(new SpeechError("bad_request", msg.err_msg || undefined));
    }
  }

  private finish() {
    if (!this.waiting) return;
    clearTimeout(this.waiting.timer);
    const text = this.finals.join(" ").trim();
    this.finals = [];
    this.interim = "";
    this.waiting.resolve(text);
    this.waiting = null;
  }

  push(pcm: Int16Array, speaking: boolean) {
    // Only send speech (plus a little pre-roll): silence costs money and adds nothing.
    if (speaking && !this.inTurn) {
      this.inTurn = true;
      for (const f of this.preRoll) this.transport.sendAudio(f);
      this.preRoll = [];
    }
    if (this.inTurn) this.transport.sendAudio(pcm);
    else {
      this.preRoll.push(pcm);
      if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
    }
  }

  endTurn(): Promise<string> {
    this.inTurn = false;
    return new Promise((resolve) => {
      // Ask for everything heard so far; the reply is marked from_finalize.
      this.waiting = { resolve, timer: setTimeout(() => this.finish(), 1500) };
      this.transport.sendControl({ type: "Finalize" });
    });
  }

  cancelTurn() {
    this.inTurn = false;
    this.finals = [];
    this.interim = "";
  }

  close() {
    this.transport.close({ type: "CloseStream" });
  }
}

export function createRecognizer(
  config: SttConfig,
  handlers: RecognizerHandlers = {},
  deps: RecognizerDeps = {},
): Recognizer {
  const f = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const preset = sttPreset(config.kind);
  if (!preset) throw new SpeechError("unsupported");
  if (preset.needsKey && !config.apiKey) throw new SpeechError("invalid_key", "Add your API key first.");
  const base = (config.baseUrl || preset.defaultBaseUrl).replace(/\/+$/, "");
  switch (config.kind) {
    case "openai":
      return new UtteranceRecognizer(async (wav, signal) => {
        const body = (await postWav(
          f,
          `${base}/audio/transcriptions`,
          wav,
          {
            model: config.model || preset.defaultModel,
            language: config.language ?? "",
            response_format: "json",
          },
          "file",
          { authorization: `Bearer ${config.apiKey}` },
          signal,
        )) as { text?: string };
        return body.text ?? "";
      }, handlers);
    case "whisper-cpp":
      return new UtteranceRecognizer(async (wav, signal) => {
        const body = (await postWav(
          f,
          `${base}/inference`,
          wav,
          { response_format: "json", temperature: "0", language: config.language ?? "" },
          "file",
          {},
          signal,
        )) as { text?: string };
        return body.text ?? "";
      }, handlers);
    case "deepgram":
      return new DeepgramRecognizer(config, handlers, deps.createSocket);
  }
}
