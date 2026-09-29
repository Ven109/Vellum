import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addAnthropicKey, explainFailures, mockAnthropic, newDraft } from "./fixtures.js";
import { fakeMicLaunch, writeSpeechWav } from "./voice-audio.js";

const wav = writeSpeechWav(
  [
    ["silence", 1200],
    ["speech", 1200],
    ["silence", 1500],
    ["speech", 900],
    ["silence", 1500],
  ],
  "session.wav",
);

test.use({ launchOptions: fakeMicLaunch(wav), permissions: ["microphone"] });
explainFailures();

/** OpenAI speech recognition that "hears" these utterances, one per turn. */
async function scriptedRecognition(page: Page, utterances: string[]) {
  let i = 0;
  await page.route("https://api.openai.com/v1/audio/transcriptions", (route) =>
    route.fulfill({ json: { text: utterances[i++] ?? "" } }),
  );
}

async function useOpenAiRecognition(page: Page) {
  await page.goto("/settings/voice-mode");
  await page
    .getByRole("radiogroup", { name: "Speech recognition provider" })
    .getByText("OpenAI (Whisper)")
    .click();
  const key = page.getByLabel("OpenAI (Whisper) API key");
  if (await key.isVisible()) {
    await key.fill("sk-voice-session-0001");
    await page.getByRole("button", { name: "Save key" }).click();
  }
}

const CLASSIFY: Record<string, string> = {
  "I'm writing an essay about the tools nobody notices.":
    '{"segments":[{"intent":"brief","text":"I\'m writing an essay about the tools nobody notices."}]}',
  "Keep it under 800 words.": '{"segments":[{"intent":"constraint","text":"Keep it under 800 words."}]}',
  "Hmm, let me think.": '{"segments":[{"intent":"thinking","text":"Hmm, let me think."}]}',
};

test("talk a piece through: brief, constraint and thinking aloud, with the draft writing itself", async ({
  page,
}) => {
  const writerPrompts: string[] = [];
  await mockAnthropic(page, (body) => {
    const last = body.messages.at(-1)!.content;
    if (last.includes("ready")) return "ready";
    if (body.system?.includes("You sort what a writer says")) {
      const utterance = last.split("Utterance:\n")[1]!.trim();
      return CLASSIFY[utterance] ?? '{"segments":[]}';
    }
    writerPrompts.push(`${body.system}\n---\n${last}`);
    return "Every workshop has a corner where the quiet tools live.\n\nThey never get photographed, and they do most of the work.";
  });
  await addAnthropicKey(page);
  await useOpenAiRecognition(page);
  await scriptedRecognition(page, [
    "I'm writing an essay about the tools nobody notices.",
    "Keep it under 800 words.",
    "Hmm, let me think.",
  ]);

  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Quiet tools");
  await page.getByRole("button", { name: "Voice session" }).click();
  await expect(page).toHaveURL(/\/voice$/);
  await expect(page.getByRole("heading", { name: "Quiet tools" })).toBeVisible();

  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByTestId("voice-status")).toContainText("Listening");
  const stack = page.getByRole("complementary", { name: "Voice stack" });
  await expect(stack).toContainText("OpenAI (Whisper)");
  await expect(stack).toContainText("Anthropic");

  // Turn 1: the brief. It's recorded, acknowledged, and the draft starts writing itself.
  const transcript = page.getByRole("log", { name: "Transcript" });
  await expect(transcript).toContainText("I'm writing an essay about the tools nobody notices.", {
    timeout: 15_000,
  });
  await expect(transcript.getByText("brief")).toBeVisible();
  await expect(transcript).toContainText("Got it.");
  const doc = page.getByRole("region", { name: "Document" }).locator(".vl-prose");
  await expect(doc).toContainText("Every workshop has a corner where the quiet tools live.", {
    timeout: 15_000,
  });
  await expect(doc.locator("p")).toHaveCount(2);

  // Turn 2: a constraint, not content. It becomes a chip and never reaches the page.
  const chips = page.getByRole("list", { name: "Constraints" });
  await expect(chips.getByRole("button", { name: "Under 800 words (edit)" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(doc).not.toContainText("800");

  // Turn 3: thinking aloud writes nothing.
  await expect(transcript).toContainText("Hmm, let me think.", { timeout: 15_000 });
  await expect(transcript.getByText("thinking aloud")).toBeVisible();
  await expect(doc.locator("p")).toHaveCount(2);

  // The reaction to each turn is measured against the 300 ms budget.
  const reaction = await page.getByTestId("reaction").textContent();
  expect(Number(/(\d+) ms/.exec(reaction ?? "")?.[1])).toBeLessThanOrEqual(300);

  // Correct what it thinks it was told.
  await chips.getByRole("button", { name: "Under 800 words (edit)" }).click();
  await page.getByLabel("Edit constraint Under 800 words").fill("Under 700 words");
  await page.getByLabel("Edit constraint Under 800 words").press("Enter");
  await expect(chips.getByRole("button", { name: "Under 700 words (edit)" })).toBeVisible();
  await chips.getByRole("button", { name: "Remove constraint Under 700 words" }).click();
  await expect(chips).toHaveCount(0);

  // The drafting prompt carried the brief.
  expect(writerPrompts[0]).toContain("the tools nobody notices");

  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByTestId("voice-status")).toHaveText("Not listening");
  await page.getByRole("link", { name: "Back to editor" }).click();
  await expect(page.locator(".vl-prose")).toContainText("quiet tools live");
  // Nothing is left marked as in flight, and the agent's writing is in history under its own name.
  await expect(page.locator(".vl-prose .vl-agent-text")).toHaveCount(0);
  await page.getByRole("button", { name: "Version history" }).click();
  await expect(page.getByText(/Assistant \(claude-[\w.-]+\), asked by You/).first()).toBeVisible();
});

test("without speech recognition set up, it says where to set it up", async ({ page }) => {
  await page.goto("/library");
  await page.evaluate(() =>
    localStorage.setItem("vellum:voice:speech", JSON.stringify({ stt: null, tts: { kind: "system" } })),
  );
  await newDraft(page);
  await page.getByRole("button", { name: "Voice session" }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a speech recognition provider");
  await page.getByRole("alert").getByRole("link", { name: "Open voice settings" }).click();
  await expect(page).toHaveURL(/\/settings\/voice-mode$/);
});
