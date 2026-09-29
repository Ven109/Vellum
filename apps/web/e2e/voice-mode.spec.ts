import { expect, test } from "@playwright/test";
import { fakeMicLaunch, writeSpeechWav } from "./voice-audio.js";

const wav = writeSpeechWav([
  ["silence", 1500],
  ["speech", 1400],
  ["silence", 1600],
  ["speech", 900],
  ["silence", 1600],
]);

test.use({ launchOptions: fakeMicLaunch(wav), permissions: ["microphone"] });

test("check the microphone: level, speech turns and end-of-turn latency within budget", async ({ page }) => {
  await page.goto("/settings/voice-mode");
  await expect(page.getByRole("heading", { name: "Voice mode" })).toBeVisible();
  await page.getByRole("button", { name: "Test microphone" }).click();
  await expect(page.getByTestId("mic-status")).toContainText("Listening on");

  // The fake microphone "speaks": the meter moves and a turn starts...
  await expect(page.getByTestId("mic-status")).toHaveText("Hearing you…", { timeout: 10_000 });
  await expect
    .poll(() => page.getByRole("meter", { name: "Input level" }).getAttribute("aria-valuenow").then(Number))
    .toBeGreaterThan(20);
  // ...and ends, noticed well inside the 300 ms budget.
  await expect(page.getByTestId("mic-status")).toContainText("1 turn heard", { timeout: 10_000 });
  const text = await page.getByTestId("turn-latency").textContent();
  const ms = Number(/stopped in (\d+) ms/.exec(text ?? "")?.[1]);
  expect(ms).toBeGreaterThan(100);
  expect(ms).toBeLessThan(300);
  await expect(page.getByTestId("turn-latency")).toHaveClass("vl-ok");

  await expect(page.getByTestId("mic-status")).toContainText("2 turns heard", { timeout: 10_000 });
  await page.getByRole("button", { name: "Stop test" }).click();
  await expect(page.getByTestId("mic-status")).toHaveCount(0);

  // The device list is filled in once the page may use the microphone.
  await expect(page.getByRole("combobox", { name: "Microphone" }).getByRole("option")).not.toHaveCount(1);
});

test("a blocked microphone explains what to do", async ({ page, context }) => {
  await context.clearPermissions();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  });
  await page.goto("/settings/voice-mode");
  await page.getByRole("button", { name: "Test microphone" }).click();
  await expect(page.getByRole("alert")).toContainText("Microphone access is blocked");
});

function toneWav(ms = 300) {
  const rate = 16_000;
  const n = (rate * ms) / 1000;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return buf;
}

test.describe("speech providers", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("vellum:voice:speech"));
  });

  test("OpenAI transcribes each turn with your key", async ({ page }) => {
    const requests: Array<{ auth: string | null; type: string | null; size: number }> = [];
    await page.route("https://api.openai.com/v1/audio/transcriptions", async (route) => {
      const r = route.request();
      requests.push({
        auth: r.headers()["authorization"] ?? null,
        type: r.headers()["content-type"] ?? null,
        size: r.postDataBuffer()?.length ?? 0,
      });
      await route.fulfill({ json: { text: "Every workshop has one tool nobody talks about." } });
    });
    await page.goto("/settings/voice-mode");
    const stt = page.getByRole("radiogroup", { name: "Speech recognition provider" });
    await stt.getByText("OpenAI (Whisper)").click();
    await page.getByLabel("OpenAI (Whisper) API key").fill("sk-test-voice-1234");
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByText("OpenAI (Whisper) key ••••1234")).toBeVisible();

    await page.getByRole("button", { name: "Test microphone" }).click();
    await expect(page.getByTestId("heard")).toHaveText(
      "Heard: Every workshop has one tool nobody talks about.",
      {
        timeout: 15_000,
      },
    );
    expect(requests[0]!.auth).toBe("Bearer sk-test-voice-1234");
    expect(requests[0]!.type).toContain("multipart/form-data");
    // About 1.4 s of speech plus pre-roll and hangover at 16 kHz × 2 bytes.
    expect(requests[0]!.size).toBeGreaterThan(40_000);
    await page.getByRole("button", { name: "Stop test" }).click();

    // Reload: the choice is remembered and the key stays in the vault, never in settings.
    await page.reload();
    await expect(page.getByText("OpenAI (Whisper) key ••••1234")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("vellum:voice:speech"))).not.toContain("sk-test");
  });

  test("Deepgram streams: words appear while you speak", async ({ page }) => {
    const seen = { binary: 0, finalize: 0, protocol: "" };
    await page.routeWebSocket(/wss:\/\/api\.deepgram\.com\/v1\/listen/, (ws) => {
      seen.protocol = ws.url();
      let sentInterim = false;
      ws.onMessage((m) => {
        if (typeof m !== "string") {
          seen.binary++;
          if (!sentInterim && seen.binary > 10) {
            sentInterim = true;
            ws.send(
              JSON.stringify({
                type: "Results",
                is_final: false,
                channel: { alternatives: [{ transcript: "keep it" }] },
              }),
            );
          }
          return;
        }
        const msg = JSON.parse(m) as { type: string };
        if (msg.type === "Finalize") {
          seen.finalize++;
          ws.send(
            JSON.stringify({
              type: "Results",
              is_final: true,
              from_finalize: true,
              channel: { alternatives: [{ transcript: "Keep it under eight hundred words." }] },
            }),
          );
        }
      });
    });
    await page.goto("/settings/voice-mode");
    await page.getByRole("radiogroup", { name: "Speech recognition provider" }).getByText("Deepgram").click();
    await page.getByLabel("Deepgram API key").fill("dg-test-key-5678");
    await page.getByRole("button", { name: "Save key" }).click();
    await page.getByRole("button", { name: "Test microphone" }).click();
    await expect(page.getByTestId("interim")).toHaveText("keep it", { timeout: 15_000 });
    await expect(page.getByTestId("heard")).toHaveText("Heard: Keep it under eight hundred words.", {
      timeout: 15_000,
    });
    expect(seen.protocol).toContain("encoding=linear16");
    expect(seen.finalize).toBeGreaterThan(0);
  });

  test("whisper.cpp runs locally without a key", async ({ page }) => {
    await page.route("http://127.0.0.1:8080/inference", (route) =>
      route.fulfill({ json: { text: " local words " } }),
    );
    await page.goto("/settings/voice-mode");
    await page
      .getByRole("radiogroup", { name: "Speech recognition provider" })
      .getByText("whisper.cpp (local)")
      .click();
    await expect(page.getByLabel("Server address")).toHaveValue("http://127.0.0.1:8080");
    await expect(page.getByRole("button", { name: "Save key" })).toHaveCount(0);
    await page.getByRole("button", { name: "Test microphone" }).click();
    await expect(page.getByTestId("heard")).toHaveText("Heard: local words", { timeout: 15_000 });
  });

  test("pick a voice and preview it", async ({ page }) => {
    const bodies: Array<Record<string, string>> = [];
    await page.route("https://api.openai.com/v1/audio/speech", async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, string>);
      await route.fulfill({ body: toneWav(), contentType: "audio/wav" });
    });
    await page.goto("/settings/voice-mode");
    const voices = page.getByRole("radiogroup", { name: "Voice provider" });
    await expect(voices.getByRole("radio", { name: /System voice/ })).toBeChecked();
    await voices.getByText("OpenAI", { exact: true }).click();
    await page.getByLabel("OpenAI API key").fill("sk-test-tts-4321");
    await page.getByRole("button", { name: "Save key" }).click();
    const picker = page.getByRole("combobox", { name: "Voice" });
    await expect(picker.getByRole("option", { name: "Coral — Bright and friendly" })).toBeAttached();
    await picker.selectOption("nova");
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByTestId("voice-status")).toHaveText("Playing preview…");
    await expect(page.getByTestId("voice-status")).toHaveText("", { timeout: 5000 });
    expect(bodies[0]).toMatchObject({ voice: "nova", model: "gpt-4o-mini-tts" });
    expect(bodies[0]!.input).toContain("read your drafts back");
  });
});
