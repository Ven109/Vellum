import { expect, test } from "@playwright/test";
import { addAnthropicKey, mockAnthropic, newDraft } from "./fixtures.js";
import { fakeMicLaunch, writeSpeechWav } from "./voice-audio.js";

const wav = writeSpeechWav(
  [
    ["silence", 1500],
    ["speech", 1200],
    ["silence", 5000],
  ],
  "handsfree.wav",
);

test.use({ launchOptions: fakeMicLaunch(wav), permissions: ["microphone"] });

type Win = Window & {
  __screenOff: boolean;
  __wake: string[];
  __actions: Record<string, (() => void) | null>;
};

test("hands-free: carries on with the screen off, reads new writing aloud, and has lock-screen controls", async ({
  page,
}) => {
  // Stand in for a phone: the screen can go off, and the wake lock and lock-screen controls are observable.
  await page.addInitScript(() => {
    const w = window as unknown as Win;
    w.__screenOff = false;
    w.__wake = [];
    w.__actions = {};
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => (w.__screenOff ? "hidden" : "visible"),
    });
    Object.defineProperty(Navigator.prototype, "wakeLock", {
      configurable: true,
      get: () => ({
        request: async (type: string) => {
          w.__wake.push(type);
          return { release: async () => void w.__wake.push("released") };
        },
      }),
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      w.__actions[action] = handler as (() => void) | null;
    };
  });

  const spoken: string[] = [];
  await page.route("https://api.openai.com/v1/audio/speech", async (route) => {
    spoken.push((route.request().postDataJSON() as { input: string }).input);
    // A tiny silent WAV.
    const buf = Buffer.alloc(44 + 320);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + 320, 4);
    buf.write("WAVEfmt ", 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(16000, 24);
    buf.writeUInt32LE(32000, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(320, 40);
    await route.fulfill({ body: buf, contentType: "audio/wav" });
  });
  await page.route("http://127.0.0.1:8080/inference", (route) =>
    route.fulfill({ json: { text: "I'm writing an essay about the tools nobody notices." } }),
  );
  await mockAnthropic(page, (body) => {
    const last = body.messages.at(-1)!.content;
    if (last.includes("ready")) return "ready";
    if (body.system?.includes("You sort what a writer says"))
      return `{"segments":[{"intent":"brief","text":"I'm writing an essay about the tools nobody notices."}]}`;
    return "This paragraph was written while your screen was off.";
  });
  await addAnthropicKey(page);

  await page.goto("/settings/voice-mode");
  await page
    .getByRole("radiogroup", { name: "Speech recognition provider" })
    .getByText("whisper.cpp (local)")
    .click();
  await page.getByRole("radiogroup", { name: "Voice provider" }).getByText("OpenAI", { exact: true }).click();
  const key = page.getByLabel("OpenAI API key");
  if (await key.isVisible()) {
    await key.fill("sk-handsfree-0003");
    await page.getByRole("button", { name: "Save key" }).click();
  }
  await page.getByLabel("Hands-free sessions").selectOption("on");

  try {
    await page.goto("/library");
    await newDraft(page);
    await page.getByRole("button", { name: "Voice session" }).click();
    await expect(page.getByRole("button", { name: "Hands-free" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Start talking" }).click();
    await expect(page.getByTestId("mic-pill")).toHaveText("● Mic on");

    // The screen goes off (and the window loses focus): the session carries on.
    await page.evaluate(() => {
      (window as unknown as Win).__screenOff = true;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
    });
    const doc = page.getByRole("region", { name: "Document" }).locator(".vl-prose");
    await expect(doc).toContainText("written while your screen was off", { timeout: 15_000 });
    await expect(page.getByTestId("mic-pill")).toHaveText("● Mic on");
    // You can't see it, so you hear it.
    await expect.poll(() => spoken).toContain("This paragraph was written while your screen was off.");
    expect(await page.evaluate(() => (window as unknown as Win).__wake)).toContain("screen");

    // Lock-screen controls: pause mutes, play unmutes, stop ends.
    const act = (a: string) => page.evaluate((x) => (window as unknown as Win).__actions[x]?.(), a);
    await act("pause");
    await expect(page.getByTestId("mic-pill")).toHaveText("● Mic muted");
    await act("play");
    await expect(page.getByTestId("mic-pill")).toHaveText("● Mic on");
    await act("stop");
    await expect(page.getByTestId("voice-status")).toHaveText("Not listening");
    expect(await page.evaluate(() => (window as unknown as Win).__wake)).toContain("released");
  } finally {
    await page.evaluate(() => localStorage.removeItem("vellum:voice:speech"));
  }
});

test("reading new writing aloud can be switched off, and the choice is remembered", async ({ page }) => {
  await page.goto("/settings/voice-mode");
  const readBack = page.getByRole("checkbox", { name: /Read new writing aloud when the screen is off/ });
  await expect(readBack).toBeChecked();
  await readBack.uncheck();
  await page.reload();
  await expect(readBack).not.toBeChecked();
  await page.evaluate(() => localStorage.removeItem("vellum:voice:speech"));
});
