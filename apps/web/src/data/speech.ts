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

/** Which speech providers to use. Keys live in the key vault, never in these settings. */
export interface SpeechSettings {
  stt: { kind: SttKind; baseUrl?: string; model?: string; language?: string } | null;
  tts: { kind: TtsKind; baseUrl?: string; model?: string; voice?: string };
}

const KEY = "vellum:voice:speech";
const DEFAULTS: SpeechSettings = { stt: null, tts: { kind: "system" } };

function load(): SpeechSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SpeechSettings>) } : DEFAULTS;
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
  return { ...s, ...(apiKey ? { apiKey } : {}) };
}

export async function ttsConfig(): Promise<TtsConfig> {
  const t = useSpeech.getState().settings.tts;
  const apiKey = ttsPreset(t.kind).needsKey ? await vault().reveal(ttsKeyId(t.kind)) : undefined;
  return { ...t, ...(apiKey ? { apiKey } : {}) };
}

export async function openRecognizer(handlers: RecognizerHandlers = {}): Promise<Recognizer | null> {
  const config = await sttConfig();
  return config ? createRecognizer(config, handlers) : null;
}

export async function openSynthesizer(): Promise<Synthesizer | null> {
  const config = await ttsConfig();
  return config.kind === "system" ? null : createSynthesizer(config);
}
