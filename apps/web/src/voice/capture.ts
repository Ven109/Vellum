import { Framer, Resampler, SAMPLE_RATE, Vad, floatTo16 } from "@vellum/voice";
import type { VadEvent, VadOptions } from "@vellum/voice";

export type MicError = "blocked" | "no-microphone" | "in-use" | "unsupported" | "failed";

export class MicrophoneError extends Error {
  constructor(
    readonly kind: MicError,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<MicError, string> = {
  blocked:
    "Microphone access is blocked. Allow it in your browser's site settings (or your system's privacy settings) and try again.",
  "no-microphone": "No microphone was found. Plug one in or pick another input.",
  "in-use": "The microphone is being used by another app. Close it and try again.",
  unsupported: "This browser can't capture audio here. Voice needs a secure (https) page.",
  failed: "Couldn't start the microphone.",
};

function toMicError(err: unknown): MicrophoneError {
  const name = (err as { name?: string })?.name;
  const kind: MicError =
    name === "NotAllowedError" || name === "SecurityError"
      ? "blocked"
      : name === "NotFoundError" || name === "OverconstrainedError"
        ? "no-microphone"
        : name === "NotReadableError" || name === "AbortError"
          ? "in-use"
          : "failed";
  return new MicrophoneError(kind, MESSAGES[kind]);
}

export interface TurnEnd {
  /** When you stopped speaking, on the page's clock (performance.now()). */
  stoppedAt: number;
  durationMs: number;
}

export interface MicOptions {
  deviceId?: string;
  vad?: Partial<VadOptions>;
  /** Every 20 ms frame as 16 kHz 16-bit PCM, ready for a speech provider. */
  onFrame?: (pcm: Int16Array, speaking: boolean) => void;
  /** Input level in dBFS, about 50 times a second. */
  onLevel?: (db: number) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (turn: TurnEnd) => void;
  /** The device went away (unplugged) or the browser stopped the track. */
  onEnded?: () => void;
}

export interface MicSession {
  readonly label: string;
  readonly deviceId: string | undefined;
  readonly inputRate: number;
  stop(): Promise<void>;
  /** Pause sending frames (the mic stays open, the level meter keeps moving). */
  setMuted(muted: boolean): void;
}

/**
 * Open the microphone with the browser's echo cancellation, noise suppression and gain control, and turn
 * it into 16 kHz frames plus speech start/end events. Works the same in the browser and in the desktop
 * app (which grants audio-only capture to its own page).
 */
export async function openMicrophone(options: MicOptions = {}): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined")
    throw new MicrophoneError("unsupported", MESSAGES.unsupported);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (err) {
    throw toMicError(err);
  }
  const track = stream.getAudioTracks()[0]!;
  const ctx = new AudioContext({ latencyHint: "interactive" });
  try {
    await ctx.audioWorklet.addModule("/voice-capture-worklet.js");
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new MicrophoneError("failed", MESSAGES.failed);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "vellum-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
  source.connect(node);
  if (ctx.state === "suspended") await ctx.resume();

  const resampler = new Resampler(ctx.sampleRate, SAMPLE_RATE);
  const framer = new Framer();
  const vad = new Vad(options.vad);
  let audioMs = 0;
  let muted = false;
  const handle = (e: VadEvent) => {
    if (e.type === "speech-start") options.onSpeechStart?.();
    else {
      // The frame that ended the turn was captured about `baseLatency` ago; you stopped
      // `at − lastVoiceAt` before that.
      const behind = e.at - e.lastVoiceAt + (ctx.baseLatency || 0) * 1000;
      options.onSpeechEnd?.({ stoppedAt: performance.now() - behind, durationMs: e.durationMs });
    }
  };
  node.port.onmessage = (ev: MessageEvent<{ samples: Float32Array }>) => {
    for (const frame of framer.push(resampler.process(ev.data.samples))) {
      audioMs += 20;
      const event = vad.push(frame, audioMs);
      options.onLevel?.(vad.level);
      if (event) handle(event);
      if (!muted) options.onFrame?.(floatTo16(frame), vad.isSpeaking);
    }
  };
  track.addEventListener("ended", () => options.onEnded?.());

  return {
    label: track.label || "Microphone",
    deviceId: track.getSettings().deviceId,
    inputRate: ctx.sampleRate,
    setMuted(m) {
      muted = m;
      track.enabled = !m;
      if (m) vad.reset();
    },
    async stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => undefined);
    },
  };
}

export interface MicDevice {
  deviceId: string;
  label: string;
}

/** Audio inputs. Labels only appear once the page has been allowed to use a microphone. */
export async function listMicrophones(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/** "granted", "denied", "prompt", or "unknown" where the browser won't say. */
export async function microphonePermission(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

const MIC_KEY = "vellum:voice:mic";
export const preferredMicrophone = () => {
  try {
    return localStorage.getItem(MIC_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
export const setPreferredMicrophone = (id: string | undefined) => {
  try {
    if (id) localStorage.setItem(MIC_KEY, id);
    else localStorage.removeItem(MIC_KEY);
  } catch {
    /* ignore */
  }
};
