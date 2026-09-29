import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addAnthropicKey, explainFailures, mockAnthropic, newDraft } from "./fixtures.js";
import { fakeMicLaunch, writeSpeechWav } from "./voice-audio.js";

// Two turns: the first ends ~2.6 s in, the second starts at ~4.1 s and ends ~5.2 s in.
const wav = writeSpeechWav(
  [
    ["silence", 1200],
    ["speech", 1200],
    ["silence", 1500],
    ["speech", 900],
    ["silence", 4000],
  ],
  "barge.wav",
);

test.use({ launchOptions: fakeMicLaunch(wav), permissions: ["microphone"] });
explainFailures();

async function setUp(page: Page, opts: { draftDelayMs: number; reviseSeen?: string[] }) {
  await mockAnthropic(page, async (body) => {
    const last = body.messages.at(-1)!.content;
    if (last.includes("ready")) return "ready";
    if (body.system?.includes("You sort what a writer says")) {
      const utterance = last.split("Utterance:\n")[1]!.trim();
      return utterance.startsWith("Make it")
        ? `{"segments":[{"intent":"steer","text":"${utterance}"}]}`
        : `{"segments":[{"intent":"brief","text":"${utterance}"}]}`;
    }
    if (last.includes("paragraphs are numbered")) {
      opts.reviseSeen?.push(last);
      return '{"edits":[{"paragraph":1,"text":"The first sentence stays, and it is warmer now."}]}';
    }
    await new Promise((r) => setTimeout(r, opts.draftDelayMs));
    return "The first sentence stays. The second sentence only lands if the instruction waits.";
  });
  await addAnthropicKey(page);
  await page.goto("/settings/voice-mode");
  await page
    .getByRole("radiogroup", { name: "Speech recognition provider" })
    .getByText("OpenAI (Whisper)")
    .click();
  const key = page.getByLabel("OpenAI (Whisper) API key");
  if (await key.isVisible()) {
    await key.fill("sk-barge-in-0001");
    await page.getByRole("button", { name: "Save key" }).click();
  }
  const heard = ["I'm writing an essay about the tools nobody notices.", "Make it warmer."];
  let i = 0;
  await page.route("https://api.openai.com/v1/audio/transcriptions", (route) =>
    route.fulfill({ json: { text: heard[i++] ?? "" } }),
  );
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("button", { name: "Voice session" }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
}

const doc = (page: Page) => page.getByRole("region", { name: "Document" }).locator(".vl-prose");

test("an instruction mid-write is applied after the current sentence by default", async ({ page }) => {
  const revise: string[] = [];
  await setUp(page, { draftDelayMs: 4000, reviseSeen: revise });
  await expect(page.getByTestId("agent-writing")).toBeVisible({ timeout: 10_000 });
  const card = page.getByRole("alertdialog", { name: "Heard an instruction" });
  await expect(card).toContainText("Make it warmer.", { timeout: 10_000 });
  await expect(card.getByTestId("instruction-default")).toContainText("after this sentence");
  // Nobody chooses: the draft finishes its sentence, stops, and the instruction runs.
  await expect(card).toBeHidden({ timeout: 10_000 });
  await expect(doc(page)).toHaveText("The first sentence stays, and it is warmer now.", { timeout: 10_000 });
  expect(revise[0]).toContain("Make it warmer.");
  expect(revise[0]).toContain("[1] The first sentence stays.");
  await expect(doc(page)).not.toContainText("second sentence");
});

test("Queue it lets the current writing finish first", async ({ page }) => {
  const revise: string[] = [];
  await setUp(page, { draftDelayMs: 4000, reviseSeen: revise });
  const card = page.getByRole("alertdialog", { name: "Heard an instruction" });
  await card.getByRole("button", { name: "Queue it" }).click({ timeout: 10_000 });
  await expect(card).toBeHidden();
  // The instruction ran only after the whole draft was written.
  await expect(doc(page)).toContainText("warmer now", { timeout: 10_000 });
  expect(revise[0]).toContain(
    "[1] The first sentence stays. The second sentence only lands if the instruction waits.",
  );
});

test("Ignore drops the instruction and writing carries on", async ({ page }) => {
  const revise: string[] = [];
  await setUp(page, { draftDelayMs: 4000, reviseSeen: revise });
  const card = page.getByRole("alertdialog", { name: "Heard an instruction" });
  await card.getByRole("button", { name: "Ignore" }).click({ timeout: 10_000 });
  await expect(doc(page)).toContainText("The second sentence only lands", { timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(revise).toEqual([]);
});

test("talking over the agent stops its voice at once", async ({ page }) => {
  await page.route("https://api.openai.com/v1/audio/speech", (route) => {
    // Six seconds of quiet tone: long enough to be talked over.
    const rate = 16_000;
    const n = rate * 6;
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
      buf.writeInt16LE(Math.round(300 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
    return route.fulfill({ body: buf, contentType: "audio/wav" });
  });
  await page.goto("/settings/voice-mode");
  await page.getByRole("radiogroup", { name: "Voice provider" }).getByText("OpenAI", { exact: true }).click();
  const key = page.getByLabel("OpenAI API key");
  if (await key.isVisible()) {
    await key.fill("sk-tts-barge-0002");
    await page.getByRole("button", { name: "Save key" }).click();
  }
  try {
    await setUp(page, { draftDelayMs: 0 });
    // "Got it." is spoken after the first turn...
    const speaking = page.getByTestId("agent-speaking");
    await expect(speaking).toBeVisible({ timeout: 10_000 });
    const since = Date.now();
    // ...and cut off when the second turn starts, well before the six-second clip ends.
    await expect(speaking).toBeHidden({ timeout: 5000 });
    expect(Date.now() - since).toBeLessThan(4000);
  } finally {
    await page.evaluate(() => localStorage.removeItem("vellum:voice:speech"));
  }
});
