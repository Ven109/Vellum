import type { Synthesizer, TtsConfig, VoiceOption } from "@vellum/voice";
import { SpeechError, createSynthesizer } from "@vellum/voice";

export type SpeakerState = "idle" | "loading" | "speaking";

/** The device's own voices, through the Web Speech API. */
export function systemVoices(): Promise<VoiceOption[]> {
  const synth = typeof speechSynthesis === "undefined" ? null : speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const read = () =>
    synth.getVoices().map((v) => ({
      id: v.voiceURI,
      name: v.name,
      description: `${v.lang}${v.localService ? "" : ", online"}`,
    }));
  const now = read();
  if (now.length) return Promise.resolve(now);
  // Chrome loads the list asynchronously.
  return new Promise((resolve) => {
    const done = () => resolve(read());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1000);
  });
}

/**
 * Speaks text with the chosen voice and can be cut off instantly (so you can talk over it). Only one
 * utterance plays at a time; a new one replaces the old.
 */
export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private controller: AbortController | null = null;
  private url: string | null = null;
  private synth: Synthesizer | null;
  state: SpeakerState = "idle";
  onState?: (s: SpeakerState) => void;

  constructor(private readonly config: TtsConfig) {
    this.synth = config.kind === "system" ? null : createSynthesizer(config);
  }

  private set(s: SpeakerState) {
    this.state = s;
    this.onState?.(s);
  }

  async listVoices(): Promise<VoiceOption[]> {
    return this.synth ? this.synth.listVoices() : systemVoices();
  }

  /** Resolves when the speech has finished (or was stopped). */
  async speak(text: string, previewUrl?: string): Promise<void> {
    this.stop();
    if (!this.synth) return this.speakSystem(text);
    const controller = new AbortController();
    this.controller = controller;
    this.set("loading");
    try {
      let src = previewUrl;
      if (!src) {
        const res = await this.synth.synthesize(text, controller.signal);
        src = this.url = URL.createObjectURL(await res.blob());
      }
      if (controller.signal.aborted) return;
      const audio = new Audio(src);
      this.audio = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onpause = () => resolve();
        audio.onerror = () => reject(new SpeechError("bad_request", "Couldn't play the audio."));
        audio.play().then(() => this.set("speaking"), reject);
      });
    } finally {
      if (this.controller === controller) this.cleanup();
    }
  }

  private speakSystem(text: string): Promise<void> {
    if (typeof speechSynthesis === "undefined") return Promise.reject(new SpeechError("unsupported"));
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === this.config.voice);
      if (voice) u.voice = voice;
      u.onstart = () => this.set("speaking");
      u.onend = u.onerror = () => {
        this.set("idle");
        resolve();
      };
      this.set("loading");
      speechSynthesis.speak(u);
    });
  }

  /** Stop at once: used when you start talking over it. */
  stop() {
    this.controller?.abort();
    if (this.audio) {
      this.audio.onpause = null;
      this.audio.pause();
    }
    if (!this.synth && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.cleanup();
  }

  private cleanup() {
    this.controller = null;
    this.audio = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (this.state !== "idle") this.set("idle");
  }
}
