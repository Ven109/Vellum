import { FRAME_MS, levelDb } from "./pcm.js";

export interface VadOptions {
  /** How far above the noise floor counts as voice. */
  onsetDb: number;
  /** Voice must stay above this (relative to the floor) to keep a turn open. */
  sustainDb: number;
  /** Nothing quieter than this is ever speech, however quiet the room. */
  minSpeechDb: number;
  /** Consecutive voiced time before a turn starts (ignores clicks and taps). */
  minSpeechMs: number;
  /** Silence after the last voiced frame before the turn ends. The main cost in end-of-turn latency. */
  hangoverMs: number;
  /** Time spent learning the room's noise level before listening for speech. */
  calibrationMs: number;
  frameMs: number;
}

export const DEFAULT_VAD: VadOptions = {
  onsetDb: 12,
  sustainDb: 7,
  minSpeechDb: -52,
  minSpeechMs: 60,
  hangoverMs: 180,
  calibrationMs: 200,
  frameMs: FRAME_MS,
};

export type VadEvent =
  | { type: "speech-start"; at: number }
  /** `lastVoiceAt` is when the speaker actually stopped; `at` is when we decided the turn was over. */
  | { type: "speech-end"; at: number; lastVoiceAt: number; durationMs: number };

/**
 * Energy-based voice activity detection with an adaptive noise floor. Cheap enough to run on every 20 ms
 * frame on the main thread; the browser's own noise suppression and echo cancellation run before it.
 */
export class Vad {
  readonly options: VadOptions;
  private floor = -70;
  private calibrated = 0;
  private speaking = false;
  private voicedRun = 0;
  private startedAt = 0;
  private lastVoiceAt = 0;
  private time = 0;
  level = -100;

  constructor(options: Partial<VadOptions> = {}) {
    this.options = { ...DEFAULT_VAD, ...options };
  }

  get isSpeaking() {
    return this.speaking;
  }

  get noiseFloor() {
    return this.floor;
  }

  /** Feed one frame; `at` is the frame's end time in ms on the audio clock (defaults to counting frames). */
  push(frame: Float32Array, at?: number): VadEvent | null {
    const o = this.options;
    this.time = at ?? this.time + o.frameMs;
    const db = levelDb(frame);
    this.level = db;
    if (this.calibrated < o.calibrationMs) {
      // Start from the room as it is: average the first frames into the floor.
      this.floor = this.calibrated === 0 ? db : this.floor + (db - this.floor) * 0.3;
      this.calibrated += o.frameMs;
      return null;
    }
    const loud = db > Math.max(o.minSpeechDb, this.floor + (this.speaking ? o.sustainDb : o.onsetDb));

    if (!this.speaking) {
      // Track the room: fall quickly to quieter levels, rise slowly so speech doesn't become "noise".
      this.floor += (db - this.floor) * (db < this.floor ? 0.3 : 0.02);
      if (loud) {
        this.voicedRun += o.frameMs;
        if (this.voicedRun === o.frameMs) this.startedAt = this.time - o.frameMs;
        if (this.voicedRun >= o.minSpeechMs) {
          this.speaking = true;
          this.lastVoiceAt = this.time;
          return { type: "speech-start", at: this.startedAt };
        }
      } else this.voicedRun = 0;
      return null;
    }

    if (loud) {
      this.lastVoiceAt = this.time;
      return null;
    }
    if (this.time - this.lastVoiceAt >= o.hangoverMs) {
      this.speaking = false;
      this.voicedRun = 0;
      return {
        type: "speech-end",
        at: this.time,
        lastVoiceAt: this.lastVoiceAt,
        durationMs: this.lastVoiceAt - this.startedAt,
      };
    }
    return null;
  }

  /** Forget the current turn (the room calibration is kept). */
  reset() {
    this.speaking = false;
    this.voicedRun = 0;
  }
}
