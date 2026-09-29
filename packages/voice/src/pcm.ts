/** The format every speech provider gets: 16 kHz, mono, 16-bit little-endian PCM in 20 ms frames. */
export const SAMPLE_RATE = 16_000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;

/** Average the channels of a multi-channel buffer into one. */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i]! += ch[i]! / channels.length;
  return out;
}

/** A second-order low-pass section (RBJ biquad, Butterworth Q). */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(cutoff: number, rate: number, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * cutoff) / rate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = (1 - cos) / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/**
 * Streaming sample-rate converter: an anti-aliasing low-pass (three cascaded biquads, 36 dB/octave)
 * ahead of linear interpolation when downsampling. Keeps its state across chunks, so audio delivered in
 * 128-sample render quanta converts without clicks at the seams.
 */
export class Resampler {
  private readonly step: number;
  private pos = 0;
  private last = 0;
  private readonly filters: Biquad[];

  constructor(
    readonly from: number,
    readonly to: number = SAMPLE_RATE,
  ) {
    if (from <= 0 || to <= 0) throw new Error("sample rates must be positive");
    this.step = from / to;
    this.filters = from > to ? [0, 1, 2].map(() => new Biquad(0.42 * to, from)) : [];
  }

  process(input: Float32Array): Float32Array {
    if (this.from === this.to) return input;
    const filtered = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let v = input[i]!;
      for (const f of this.filters) v = f.step(v);
      filtered[i] = v;
    }
    const out: number[] = [];
    // `pos` is measured from the previous chunk's last sample (index -1).
    while (this.pos < filtered.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i === 0 ? this.last : filtered[i - 1]!;
      const b = filtered[i]!;
      out.push(a + (b - a) * frac);
      this.pos += this.step;
    }
    this.pos -= filtered.length;
    if (filtered.length) this.last = filtered[filtered.length - 1]!;
    return Float32Array.from(out);
  }
}

/** Float samples (−1…1) to 16-bit PCM, clipping out-of-range values. */
export function floatTo16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Cut a stream of samples into fixed-size frames, carrying the remainder to the next call. */
export class Framer {
  private buf = new Float32Array(0);
  constructor(readonly size: number = FRAME_SAMPLES) {}

  push(samples: Float32Array): Float32Array[] {
    const joined = new Float32Array(this.buf.length + samples.length);
    joined.set(this.buf);
    joined.set(samples, this.buf.length);
    const frames: Float32Array[] = [];
    let at = 0;
    for (; at + this.size <= joined.length; at += this.size) frames.push(joined.slice(at, at + this.size));
    this.buf = joined.slice(at);
    return frames;
  }
}

/** Root-mean-square level of a frame, in dBFS (−100 for silence). */
export function levelDb(frame: Float32Array): number {
  if (!frame.length) return -100;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  const rms = Math.sqrt(sum / frame.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/** A 0…1 value for level meters: −60 dBFS and below is 0, −10 dBFS and above is 1. */
export function meterValue(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 50));
}

/** A WAV file (16-bit mono) from PCM, for sending whole utterances to request/response speech APIs. */
export function encodeWav(pcm: Int16Array, sampleRate: number = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i]!, true);
  return bytes;
}
