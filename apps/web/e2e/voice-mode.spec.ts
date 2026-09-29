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
