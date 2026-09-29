import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newDraft } from "./fixtures.js";
import { fakeMicLaunch, writeSpeechWav } from "./voice-audio.js";

const wav = writeSpeechWav(
  [
    ["silence", 1200],
    ["speech", 1000],
    ["silence", 3000],
  ],
  "privacy.wav",
);

test.use({ launchOptions: fakeMicLaunch(wav), permissions: ["microphone"] });

test.afterEach(async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem("vellum:voice:speech"));
});

const sttGroup = (page: Page) => page.getByRole("radiogroup", { name: "Speech recognition provider" });

test("says plainly where audio goes and what the provider keeps", async ({ page }) => {
  await page.goto("/settings/voice-mode");
  const facts = page.getByTestId("privacy-facts");
  await expect(page.getByText("Vellum never records or stores your audio.")).toBeVisible();
  await expect(facts).toContainText("Nowhere yet");

  await sttGroup(page).getByText("Deepgram").click();
  await expect(facts).toContainText("Deepgram (api.deepgram.com), streamed while you speak");
  await expect(facts).toContainText("opts out of Deepgram's model improvement");
  // Retention opt-out is on by default, and can be turned off.
  const noRetention = page.getByRole("checkbox", { name: /Ask providers not to keep my audio/ });
  await expect(noRetention).toBeChecked();
  await noRetention.uncheck();
  await expect(facts).toContainText("may keep your audio to improve its models");

  await sttGroup(page).getByText("whisper.cpp (local)").click();
  await expect(facts).toContainText("Your own machine (whisper.cpp at 127.0.0.1:8080)");
  await expect(facts).toContainText("Replies are spoken byYour device's built-in voices");
});

test("local-only mode keeps every byte of audio on this machine", async ({ page }) => {
  await page.goto("/settings/voice-mode");
  await sttGroup(page).getByText("OpenAI (Whisper)").click();
  await page.getByRole("checkbox", { name: /Local only/ }).check();
  await expect(sttGroup(page).getByRole("radio", { name: /OpenAI \(Whisper\)/ })).toBeDisabled();
  await expect(sttGroup(page).getByRole("radio", { name: /Deepgram/ })).toBeDisabled();
  await expect(
    page.getByRole("radiogroup", { name: "Voice provider" }).getByRole("radio", { name: /ElevenLabs/ }),
  ).toBeDisabled();

  // A cloud recogniser chosen earlier is refused rather than quietly used.
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("button", { name: "Voice session" }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByRole("alert")).toContainText("Local-only mode is on");
  await expect(page.getByTestId("mic-pill")).toHaveCount(0);
});

test("self-hosters can require local-only voice for everyone", async ({ page }) => {
  await page.route("**/api/instance", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), voice: { localOnly: true } } });
  });
  await page.goto("/settings/voice-mode");
  const localOnly = page.getByRole("checkbox", { name: /Local only/ });
  await expect(localOnly).toBeChecked();
  await expect(localOnly).toBeDisabled();
  await expect(page.getByText("Required by your server's administrator.")).toBeVisible();
  await expect(sttGroup(page).getByRole("radio", { name: /Deepgram/ })).toBeDisabled();
});

test("mic on is unmistakable; keyboard starts and stops; leaving the window ends the session", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:8080/inference", (route) =>
    route.fulfill({ json: { text: "Hmm, let me think." } }),
  );
  await page.goto("/settings/voice-mode");
  await sttGroup(page).getByText("whisper.cpp (local)").click();
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Private draft");
  await page.getByRole("button", { name: "Voice session" }).click();
  await expect(page.getByRole("heading", { name: "Private draft" })).toBeVisible();

  // Keyboard only.
  await page.keyboard.press("ControlOrMeta+Shift+Space");
  const pill = page.getByTestId("mic-pill");
  await expect(pill).toHaveText("● Mic on");
  await expect(page).toHaveTitle(/^● Mic on · /);
  await expect(page.getByTestId("announcer")).toHaveText("Listening.");
  await expect(page.getByTestId("audio-to")).toContainText("Your own machine");

  await page.getByRole("button", { name: "Mute" }).click();
  await expect(pill).toHaveText("● Mic muted");
  await expect(page).not.toHaveTitle(/Mic on/);
  await page.getByRole("button", { name: "Unmute" }).click();
  await page.keyboard.press("ControlOrMeta+Shift+Space");
  await expect(page.getByTestId("voice-status")).toHaveText("Not listening");
  await expect(pill).toHaveCount(0);

  // Switching away closes the microphone.
  await page.keyboard.press("ControlOrMeta+Shift+Space");
  await expect(pill).toHaveText("● Mic on");
  await expect(page.getByRole("log", { name: "Transcript" })).toContainText("Hmm, let me think.", {
    timeout: 15_000,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByTestId("voice-status")).toHaveText("Not listening");
  await expect(page.getByRole("alert")).toContainText("no longer in front");

  // The transcript can be deleted.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete transcript" }).click();
  await expect(page.getByRole("log", { name: "Transcript" })).not.toContainText("Hmm, let me think.");
  await page.reload();
  await expect(page.getByRole("log", { name: "Transcript" })).not.toContainText("Hmm, let me think.");
});
