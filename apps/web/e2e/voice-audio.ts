import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A WAV for Chromium's fake microphone: silence, then "speech" (a voiced, amplitude-modulated tone with
 * harmonics, like a vowel), then silence, repeated. Chromium loops the file.
 */
export function writeSpeechWav(script: Array<[kind: "speech" | "silence", ms: number]>, name = "voice.wav") {
  const rate = 48_000;
  const samples: number[] = [];
  for (const [kind, ms] of script) {
    const n = Math.round((rate * ms) / 1000);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      if (kind === "silence") samples.push((Math.random() - 0.5) * 0.001);
      else {
        const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t);
        const pitch = 140 + 20 * Math.sin(2 * Math.PI * 0.7 * t);
        let v = 0;
        for (const [h, a] of [
          [1, 1],
          [2, 0.6],
          [3, 0.4],
          [5, 0.25],
          [8, 0.1],
        ] as const)
          v += a * Math.sin(2 * Math.PI * pitch * h * t);
        samples.push(0.18 * syllable * v + (Math.random() - 0.5) * 0.02);
      }
    }
  }
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2),
  );
  const path = join(tmpdir(), `vellum-${process.pid}-${name}`);
  writeFileSync(path, data);
  return path;
}

/** Launch options for a Chromium with a fake microphone playing `wav`. */
export function fakeMicLaunch(wav: string) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  return {
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  };
}
