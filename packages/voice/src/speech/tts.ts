import { SpeechError, networkError, speechErrorFrom } from "./types.js";
import type { PrivacyFacts, TtsConfig, TtsKind, VoiceOption } from "./types.js";

export interface TtsPreset {
  kind: TtsKind;
  label: string;
  description: string;
  needsKey: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultVoice: string;
  keyUrl?: string;
  local: boolean;
  privacy: (config: Pick<TtsConfig, "zeroRetention">) => PrivacyFacts;
}

export const TTS_PRESETS: TtsPreset[] = [
  {
    kind: "system",
    label: "System voice",
    description: "Your device's built-in voices. No key, nothing to set up.",
    needsKey: false,
    defaultBaseUrl: "",
    defaultModel: "",
    defaultVoice: "",
    local: true,
    privacy: () => ({
      destination: "Your device's built-in voices",
      local: true,
      retention:
        "Replies are spoken on this device. (Voices your browser marks as online may use its maker's service.)",
    }),
  },
  {
    kind: "openai",
    label: "OpenAI",
    description: "Natural voices with your OpenAI key.",
    needsKey: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini-tts",
    defaultVoice: "coral",
    keyUrl: "https://platform.openai.com/api-keys",
    local: false,
    privacy: () => ({
      destination: "OpenAI (api.openai.com): the text of replies, never your audio",
      local: false,
      retention:
        "OpenAI may keep requests for up to 30 days to detect abuse, unless your organisation has zero data retention.",
    }),
  },
  {
    kind: "elevenlabs",
    label: "ElevenLabs",
    description: "Expressive voices, including your own cloned voice, with your ElevenLabs key.",
    needsKey: true,
    defaultBaseUrl: "https://api.elevenlabs.io/v1",
    defaultModel: "eleven_flash_v2_5",
    defaultVoice: "21m00Tcm4TlvDq8ikWAM",
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
    local: false,
    privacy: (c) => ({
      destination: "ElevenLabs (api.elevenlabs.io): the text of replies, never your audio",
      local: false,
      retention: c.zeroRetention
        ? "Zero-retention mode is on: ElevenLabs doesn't keep the text or the audio."
        : "ElevenLabs keeps request history in your account. Zero-retention mode is available on its enterprise plans.",
    }),
  },
];

export const ttsPreset = (kind: TtsKind) => TTS_PRESETS.find((p) => p.kind === kind)!;

const OPENAI_VOICES: VoiceOption[] = [
  ["alloy", "Neutral and even"],
  ["ash", "Clear and direct"],
  ["ballad", "Warm, a little musical"],
  ["coral", "Bright and friendly"],
  ["echo", "Calm, lower register"],
  ["fable", "Storyteller"],
  ["nova", "Energetic"],
  ["onyx", "Deep and steady"],
  ["sage", "Thoughtful"],
  ["shimmer", "Soft and light"],
].map(([id, description]) => ({ id: id!, name: id![0]!.toUpperCase() + id!.slice(1), description }));

export interface SynthDeps {
  fetch?: typeof fetch;
}

/** Everything that speaks through an HTTP API (the system voice is played by the page itself). */
export interface Synthesizer {
  listVoices(): Promise<VoiceOption[]>;
  /** Audio for `text` (MP3), as a stream so playback can start before the whole clip has arrived. */
  synthesize(text: string, signal?: AbortSignal): Promise<Response>;
}

export function createSynthesizer(config: TtsConfig, deps: SynthDeps = {}): Synthesizer {
  const f = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const preset = ttsPreset(config.kind);
  if (!preset || config.kind === "system") throw new SpeechError("unsupported");
  if (preset.needsKey && !config.apiKey) throw new SpeechError("invalid_key", "Add your API key first.");
  const base = (config.baseUrl || preset.defaultBaseUrl).replace(/\/+$/, "");
  const call = async (url: string, init: RequestInit) => {
    let res: Response;
    try {
      res = await f(url, init);
    } catch (e) {
      throw networkError(e);
    }
    if (!res.ok) throw await speechErrorFrom(res);
    return res;
  };

  if (config.kind === "openai") {
    return {
      listVoices: async () => OPENAI_VOICES,
      synthesize: (text, signal) =>
        call(`${base}/audio/speech`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: config.model || preset.defaultModel,
            voice: config.voice || preset.defaultVoice,
            input: text,
            response_format: "mp3",
          }),
          ...(signal ? { signal } : {}),
        }),
    };
  }

  // ElevenLabs
  const headers = { "xi-api-key": config.apiKey ?? "" };
  return {
    async listVoices() {
      const res = await call(`${base}/voices`, { headers });
      const body = (await res.json()) as {
        voices?: Array<{
          voice_id: string;
          name: string;
          category?: string;
          preview_url?: string;
          labels?: Record<string, string>;
        }>;
      };
      return (body.voices ?? []).map((v) => ({
        id: v.voice_id,
        name: v.name,
        description: [v.labels?.accent, v.labels?.description, v.category === "cloned" ? "your voice" : ""]
          .filter(Boolean)
          .join(", "),
        ...(v.preview_url ? { previewUrl: v.preview_url } : {}),
      }));
    },
    synthesize: (text, signal) =>
      call(
        `${base}/text-to-speech/${encodeURIComponent(config.voice || preset.defaultVoice)}/stream?output_format=mp3_44100_128${config.zeroRetention ? "&enable_logging=false" : ""}`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: config.model || preset.defaultModel }),
          ...(signal ? { signal } : {}),
        },
      ),
  };
}

export const PREVIEW_TEXT = "Hello. I'll read your drafts back to you, and write down what you tell me.";
