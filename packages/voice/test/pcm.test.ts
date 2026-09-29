import { describe, expect, it } from "vitest";
import { Framer, Resampler, downmix, encodeWav, floatTo16, levelDb, meterValue } from "../src/pcm.js";

const sine = (hz: number, rate: number, ms: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round((rate * ms) / 1000) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate),
  );

describe("Resampler", () => {
  it("converts 48 kHz to 16 kHz with the right number of samples, across chunk seams", () => {
    const r = new Resampler(48_000, 16_000);
    const input = sine(440, 48_000, 1000);
    let total = 0;
    for (let i = 0; i < input.length; i += 128) total += r.process(input.subarray(i, i + 128)).length;
    expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(1);
  });

  it("keeps a speech-band tone and its level", () => {
    const out = new Resampler(44_100, 16_000).process(sine(300, 44_100, 500));
    expect(Math.abs(levelDb(out.subarray(200)) - levelDb(sine(300, 16_000, 480)))).toBeLessThan(1.5);
  });

  it("damps tones above the new Nyquist rather than aliasing them", () => {
    const out = new Resampler(48_000, 16_000).process(sine(15_000, 48_000, 500));
    expect(levelDb(out.subarray(200))).toBeLessThan(levelDb(sine(15_000, 48_000, 500)) - 15);
  });

  it("passes audio through when the rates match", () => {
    const x = sine(200, 16_000, 20);
    expect(new Resampler(16_000, 16_000).process(x)).toBe(x);
  });
});

describe("helpers", () => {
  it("downmixes, clips to 16-bit and frames", () => {
    expect(Array.from(downmix([Float32Array.of(1, 0), Float32Array.of(0, 1)]))).toEqual([0.5, 0.5]);
    expect(Array.from(floatTo16(Float32Array.of(-2, -1, 0, 1, 2)))).toEqual([
      -32768, -32768, 0, 32767, 32767,
    ]);
    const f = new Framer(4);
    expect(f.push(new Float32Array(6))).toHaveLength(1);
    expect(f.push(new Float32Array(2))).toHaveLength(1);
    expect(f.push(new Float32Array(3))).toHaveLength(0);
  });

  it("measures level", () => {
    expect(levelDb(new Float32Array(320))).toBe(-100);
    expect(levelDb(new Float32Array(320).fill(1))).toBeCloseTo(0, 5);
    expect(meterValue(-80)).toBe(0);
    expect(meterValue(0)).toBe(1);
  });

  it("writes a valid WAV header", () => {
    const wav = encodeWav(Int16Array.of(1, -1), 16_000);
    const text = new TextDecoder().decode(wav.subarray(0, 4)) + new TextDecoder().decode(wav.subarray(8, 12));
    expect(text).toBe("RIFFWAVE");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
    expect(wav.length).toBe(48);
  });
});
