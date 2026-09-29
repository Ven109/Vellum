import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addAnthropicKey, mockAnthropic, newDraft } from "./fixtures.js";
import { fakeMicLaunch, writeSpeechWav } from "./voice-audio.js";

const wav = writeSpeechWav(
  [
    ["silence", 1200],
    ["speech", 1200],
    ["silence", 1500],
    ["speech", 900],
    ["silence", 1500],
  ],
  "transcript.wav",
);

test.use({ launchOptions: fakeMicLaunch(wav), permissions: ["microphone"] });

async function recognise(page: Page, utterances: string[]) {
  let i = 0;
  await page.unroute("https://api.openai.com/v1/audio/transcriptions");
  await page.route("https://api.openai.com/v1/audio/transcriptions", (route) =>
    route.fulfill({ json: { text: utterances[i++] ?? "" } }),
  );
}

test("the transcript stays with the document, and paragraphs trace back to what was said", async ({
  page,
}) => {
  const writerPrompts: string[] = [];
  await mockAnthropic(page, (body) => {
    const last = body.messages.at(-1)!.content;
    if (last.includes("ready")) return "ready";
    if (body.system?.includes("You sort what a writer says")) {
      const u = last.split("Utterance:\n")[1]!.trim();
      if (u.startsWith("I'm writing")) return `{"segments":[{"intent":"brief","text":"${u}"}]}`;
      if (u.startsWith("Keep it")) return `{"segments":[{"intent":"constraint","text":"${u}"}]}`;
      return `{"segments":[{"intent":"content","text":"${u}"}]}`;
    }
    writerPrompts.push(body.system ?? "");
    return writerPrompts.length === 1
      ? "Every workshop has a corner where the quiet tools live."
      : "The block plane is the one nobody mentions.";
  });
  await addAnthropicKey(page);
  await page.goto("/settings/voice-mode");
  await page
    .getByRole("radiogroup", { name: "Speech recognition provider" })
    .getByText("OpenAI (Whisper)")
    .click();
  const key = page.getByLabel("OpenAI (Whisper) API key");
  if (await key.isVisible()) {
    await key.fill("sk-transcript-0001");
    await page.getByRole("button", { name: "Save key" }).click();
  }
  await recognise(page, ["I'm writing an essay about the tools nobody notices.", "Keep it under 800 words."]);

  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Traced");
  await page.getByRole("button", { name: "Voice session" }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
  const chips = page.getByRole("list", { name: "Constraints" });
  await expect(chips.getByRole("button", { name: "Under 800 words (edit)" })).toBeVisible({
    timeout: 20_000,
  });
  const docText = page.getByRole("region", { name: "Document" }).locator(".vl-prose");
  await expect(docText).toContainText("quiet tools live");
  await page.getByRole("button", { name: "End session" }).click();

  // Come back later: the conversation and the constraints are still there, before a session starts.
  await page.reload();
  const transcript = page.getByRole("log", { name: "Transcript" });
  await expect(transcript).toContainText("I'm writing an essay about the tools nobody notices.");
  await expect(transcript.locator("time").first()).toHaveText(/\d{1,2}:\d{2}/);
  await expect(chips.getByRole("button", { name: "Under 800 words (edit)" })).toBeVisible();

  // Click a paragraph the agent wrote: the turn it came from is highlighted.
  await docText.getByText("quiet tools live").click();
  await expect(transcript.getByRole("listitem").filter({ hasText: "I'm writing an essay" })).toHaveAttribute(
    "aria-current",
    "true",
  );

  // A new session picks up the brief and constraints from last time.
  await recognise(page, ["The block plane lives in my apron pocket."]);
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(docText).toContainText("The block plane is the one nobody mentions.", { timeout: 20_000 });
  expect(writerPrompts.at(-1)).toContain("the tools nobody notices");
  expect(writerPrompts.at(-1)).toContain("Under 800 words");
  await page.getByRole("button", { name: "End session" }).click();

  // In the editor, hovering the paragraph says what it was written from.
  await page.getByRole("link", { name: "Back to editor" }).click();
  const para = page.locator(".vl-prose p", { hasText: "quiet tools live" });
  await expect(para).toHaveAttribute(
    "title",
    /Written from what you said .*“I'm writing an essay about the tools nobody notices\.”/,
  );
});
