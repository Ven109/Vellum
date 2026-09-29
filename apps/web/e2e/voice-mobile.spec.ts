import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { addAnthropicKey, mockAnthropic } from "./fixtures.js";
import { fakeMicLaunch, writeSpeechWav } from "./voice-audio.js";

// A brief, then an instruction while the draft is still being written.
const wav = writeSpeechWav(
  [
    ["silence", 1200],
    ["speech", 1200],
    ["silence", 1500],
    ["speech", 900],
    ["silence", 6000],
  ],
  "mobile.wav",
);

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  launchOptions: fakeMicLaunch(wav),
  permissions: ["microphone"],
});

async function expectTouchTarget(button: Locator) {
  const box = (await button.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function setUp(page: Page) {
  // The screen can be turned off.
  await page.addInitScript(() => {
    const w = window as unknown as { __screenOff: boolean };
    w.__screenOff = false;
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => (w.__screenOff ? "hidden" : "visible"),
    });
  });
  await mockAnthropic(page, async (body) => {
    const last = body.messages.at(-1)!.content;
    if (last.includes("ready")) return "ready";
    if (body.system?.includes("You sort what a writer says")) {
      const utterance = last.split("Utterance:\n")[1]!.trim();
      return utterance.startsWith("Make it")
        ? `{"segments":[{"intent":"steer","text":"${utterance}"}]}`
        : `{"segments":[{"intent":"brief","text":"${utterance}"}]}`;
    }
    if (last.includes("paragraphs are numbered"))
      return '{"edits":[{"paragraph":1,"text":"Written on a phone, and warmer now."}]}';
    await new Promise((r) => setTimeout(r, 4000));
    return "Written on a phone. The rest of the draft follows.";
  });
  await addAnthropicKey(page);
  await page.goto("/settings/voice-mode");
  await page
    .getByRole("radiogroup", { name: "Speech recognition provider" })
    .getByText("OpenAI (Whisper)")
    .click();
  const key = page.getByLabel("OpenAI (Whisper) API key");
  if (await key.isVisible()) {
    await key.fill("sk-mobile-voice-0001");
    await page.getByRole("button", { name: "Save key" }).click();
  }
  const heard = ["I'm writing a short note about walking to work.", "Make it warmer."];
  let i = 0;
  await page.route("https://api.openai.com/v1/audio/transcriptions", (route) =>
    route.fulfill({ json: { text: heard[i++] ?? "" } }),
  );
}

test("voice session on a phone: draft first, a mic dock, a compact instruction card, and it survives screen lock", async ({
  page,
}) => {
  await setUp(page);
  await page.goto("/library");
  await page.getByRole("button", { name: "Open navigation" }).tap();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "New draft" }).tap();
  await page.waitForURL((url) => url.pathname.startsWith("/d/"));

  // The way in is the mic button in the phone formatting bar.
  const mic = page
    .getByRole("toolbar", { name: "Formatting" })
    .getByRole("button", { name: "Voice session" });
  await expectTouchTarget(mic);
  await mic.click();
  await expect(page).toHaveURL(/\/voice$/);

  // One pane at a time, the draft first.
  const draftTab = page.getByRole("tab", { name: "Draft" });
  const transcriptTab = page.getByRole("tab", { name: /^Transcript/ });
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Document" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation" })).toBeHidden();
  await expectTouchTarget(draftTab);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // The mic dock is fixed to the bottom of the screen.
  const dock = page.getByRole("toolbar", { name: "Microphone" });
  await dock.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByTestId("mic-pill")).toHaveText("● Mic on");
  const mute = dock.getByRole("button", { name: "Mute" });
  const end = dock.getByRole("button", { name: "End session" });
  await expectTouchTarget(mute);
  await expectTouchTarget(end);
  await expect(dock.getByRole("img", { name: /Microphone/ })).toBeVisible();
  const dockBox = (await dock.boundingBox())!;
  expect(dockBox.y + dockBox.height).toBeCloseTo(844, 0);

  // The draft writes itself where you can see it.
  const doc = page.getByRole("region", { name: "Document" }).locator(".vl-prose");
  await expect(page.getByTestId("agent-writing")).toBeVisible({ timeout: 10_000 });

  // An instruction mid-write: just Apply now or Queue it, above the dock.
  const card = page.getByRole("alertdialog", { name: "Heard an instruction" });
  await expect(card).toContainText("Make it warmer.", { timeout: 10_000 });
  await expect(card.getByRole("button", { name: "Ignore" })).toHaveCount(0);
  await expect(card.getByTestId("instruction-default")).toHaveCount(0);
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(dockBox.y);
  await expectTouchTarget(card.getByRole("button", { name: "Apply now" }));
  await card.getByRole("button", { name: "Queue it" }).click();
  await expect(card).toBeHidden();
  await expect(doc).toContainText("warmer now", { timeout: 15_000 });

  // The transcript is one tap away; the draft keeps its place.
  await transcriptTab.click();
  await expect(transcriptTab).toHaveText(/Transcript · \d+/);
  await expect(page.getByRole("log", { name: "Transcript" })).toContainText("walking to work");
  await expect(page.getByRole("region", { name: "Document" })).toBeHidden();
  await draftTab.click();
  await expect(doc).toContainText("warmer now");

  // Locking the screen doesn't end the session (hands-free is on by default on phones).
  await page.evaluate(() => {
    (window as unknown as { __screenOff: boolean }).__screenOff = true;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("blur"));
  });
  await page.waitForTimeout(500);
  await expect(page.getByTestId("mic-pill")).toHaveText("● Mic on");
  await page.evaluate(() => {
    (window as unknown as { __screenOff: boolean }).__screenOff = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await mute.click();
  await expect(page.getByTestId("mic-pill")).toHaveText("● Mic muted");
  await expect(dock.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
  await end.click();
  await expect(dock.getByRole("button", { name: "Start talking" })).toBeVisible();
  await expect(page.getByTestId("mic-pill")).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("vellum:voice:speech"));
});
