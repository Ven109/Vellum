import { describe, expect, it } from "vitest";
import { FRAME_SAMPLES } from "../src/pcm.js";
import { Vad } from "../src/vad.js";
import type { VadEvent } from "../src/vad.js";

function frame(amp: number, noise = 0.002, seed = { v: 1 }) {
  const f = new Float32Array(FRAME_SAMPLES);
  for (let i = 0; i < f.length; i++) {
    seed.v = (seed.v * 16807) % 2147483647;
    const n = (seed.v / 2147483647 - 0.5) * 2 * noise;
    f[i] = amp * Math.sin((2 * Math.PI * 220 * i) / 16_000) + n;
  }
  return f;
}

/** Run a script of [amplitude, milliseconds] segments through the VAD. */
function run(vad: Vad, script: Array<[number, number]>) {
  const events: VadEvent[] = [];
  const seed = { v: 7 };
  for (const [amp, ms] of script)
    for (let t = 0; t < ms; t += 20) {
      const e = vad.push(frame(amp, 0.002, seed));
      if (e) events.push(e);
    }
  return events;
}

describe("Vad", () => {
  it("marks a turn from the first voiced frame to the end of speech", () => {
    const vad = new Vad();
    const events = run(vad, [
      [0, 1000],
      [0.3, 1200],
      [0, 600],
    ]);
    expect(events.map((e) => e.type)).toEqual(["speech-start", "speech-end"]);
    const [start, end] = events as [
      Extract<VadEvent, { type: "speech-start" }>,
      Extract<VadEvent, { type: "speech-end" }>,
    ];
    expect(start.at).toBe(1000);
    expect(end.lastVoiceAt).toBe(2200);
    expect(end.durationMs).toBe(1200);
  });

  it("decides a turn is over within the hangover, leaving room in the 300 ms budget", () => {
    const vad = new Vad();
    const events = run(vad, [
      [0, 800],
      [0.3, 1000],
      [0, 600],
    ]);
    const end = events.find((e) => e.type === "speech-end") as Extract<VadEvent, { type: "speech-end" }>;
    expect(end.at - end.lastVoiceAt).toBe(vad.options.hangoverMs);
    expect(end.at - end.lastVoiceAt).toBeLessThan(300);
  });

  it("keeps a turn open through short pauses between words", () => {
    const events = run(new Vad(), [
      [0, 600],
      [0.3, 400],
      [0, 120],
      [0.3, 400],
      [0, 600],
    ]);
    expect(events.map((e) => e.type)).toEqual(["speech-start", "speech-end"]);
  });

  it("ignores clicks shorter than the minimum speech length", () => {
    expect(
      run(new Vad(), [
        [0, 600],
        [0.5, 40],
        [0, 600],
      ]),
    ).toEqual([]);
  });

  it("adapts to a noisy room: steady fan noise isn't speech, voice above it is", () => {
    const vad = new Vad();
    const events = run(vad, [
      [0.02, 2000],
      [0.3, 600],
      [0.02, 800],
    ]);
    expect(events.map((e) => e.type)).toEqual(["speech-start", "speech-end"]);
    expect(vad.noiseFloor).toBeGreaterThan(-45);
  });

  it("never treats near-silence as speech however quiet the room", () => {
    expect(
      run(new Vad(), [
        [0, 1000],
        [0.001, 600],
        [0, 400],
      ]),
    ).toEqual([]);
  });
});
