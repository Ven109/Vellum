import { createRecognizer, createSynthesizer, sttPreset, ttsPreset } from "@vellum/voice";
import type {
  Recognizer,
  RecognizerHandlers,
  SttConfig,
  SttKind,
  Synthesizer,
  TtsConfig,
  TtsKind,
} from "@vellum/voice";
import { create } from "zustand";
import { getKeyVault } from "./keys.js";
import type { KeyInfo } from "./keys.js";
import { useApp } from "../state/app.js";
import { useAuth } from "../state/auth.js";

/** Which speech providers to use. Keys live in the key vault, never in these settings. */
export interface VoicePrivacy {
  /** Ask speech providers not to keep audio, where they offer that. */
  noRetention: boolean;
  /** Keep all audio on this machine: local speech recognition and the system voice only. */
  localOnly: boolean;
  /** End a session when Vellum loses focus (off in hands-free mode). */
  endOnBlur: boolean;
  /** ElevenLabs zero-retention mode (enterprise plans). */
  elevenLabsZeroRetention: boolean;
}

export interface SpeechSettings {
  stt: { kind: SttKind; baseUrl?: string; model?: string; language?: string } | null;
  tts: { kind: TtsKind; baseUrl?: string; model?: string; voice?: string };
  privacy: VoicePrivacy;
}

const KEY = "vellum:voice:speech";
export const DEFAULT_PRIVACY: VoicePrivacy = {
  noRetention: true,
  localOnly: false,
  endOnBlur: true,
  elevenLabsZeroRetention: false,
};
const DEFAULTS: SpeechSettings = { stt: null, tts: { kind: "system" }, privacy: DEFAULT_PRIVACY };

function load(): SpeechSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<SpeechSettings>;
    return { ...DEFAULTS, ...saved, privacy: { ...DEFAULT_PRIVACY, ...saved.privacy } };
  } catch {
    return DEFAULTS;
  }
}

export const useSpeech = create<{
  settings: SpeechSettings;
  update(patch: Partial<SpeechSettings>): void;
}>((set, get) => ({
  settings: load(),
  update(patch) {
    const settings = { ...get().settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* this session only */
    }
    set({ settings });
  },
}));

export const sttKeyId = (kind: SttKind) => `speech-stt-${kind}`;
export const ttsKeyId = (kind: TtsKind) => `speech-tts-${kind}`;

function vault() {
  const user = useApp.getState().user;
  if (!user) throw new Error("No user");
  return getKeyVault(user.id);
}

export const saveSpeechKey = (id: string, key: string): Promise<KeyInfo> => vault().save(id, key.trim());
export const speechKeyInfo = (id: string) => vault().info(id);
export const removeSpeechKey = (id: string) => vault().remove(id);

/** The speech-to-text config with its key attached, for the moment of use only. */
export async function sttConfig(): Promise<SttConfig | null> {
  const s = useSpeech.getState().settings.stt;
  if (!s) return null;
  const apiKey = sttPreset(s.kind).needsKey ? await vault().reveal(sttKeyId(s.kind)) : undefined;
  const { noRetention } = useSpeech.getState().settings.privacy;
  return { ...s, noRetention, ...(apiKey ? { apiKey } : {}) };
}

export async function ttsConfig(): Promise<TtsConfig> {
  const { tts: t, privacy } = useSpeech.getState().settings;
  // Local-only: replies use the device's own voices.
  if (localOnlyPolicy().on && !ttsPreset(t.kind).local) return { kind: "system" };
  const apiKey = ttsPreset(t.kind).needsKey ? await vault().reveal(ttsKeyId(t.kind)) : undefined;
  return {
    ...t,
    ...(t.kind === "elevenlabs" && privacy.elevenLabsZeroRetention ? { zeroRetention: true } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

export async function openRecognizer(handlers: RecognizerHandlers = {}): Promise<Recognizer | null> {
  const config = await sttConfig();
  return config ? createRecognizer(config, handlers) : null;
}

export async function openSynthesizer(): Promise<Synthesizer | null> {
  const config = await ttsConfig();
  return config.kind === "system" ? null : createSynthesizer(config);
}

/** Local-only voice: chosen by the writer, or required by the server's administrator. */
export function localOnlyPolicy(): { on: boolean; enforced: boolean } {
  const enforced = useAuth.getState().instance?.voice?.localOnly ?? false;
  return { on: enforced || useSpeech.getState().settings.privacy.localOnly, enforced };
}
