import { expect, test } from "@playwright/test";
import { newDraft } from "./fixtures.js";

test("words you write count towards today's goal and are kept on this device", async ({ page }) => {
  await page.goto("/library");
  const meter = page.getByRole("region", { name: "Daily goal" });
  await expect(meter.getByTestId("goal-progress")).toHaveText("0 / 500 words today");

  await meter.getByRole("button", { name: "Goal" }).click();
  await meter.getByLabel("Daily goal").fill("6");
  await meter.getByRole("button", { name: "Save" }).click();
  await expect(meter.getByTestId("goal-progress")).toHaveText("0 / 6 words today");

  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Goal test");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("One two three four five six seven.");
  await expect(meter.getByTestId("goal-progress")).toHaveText("7 / 6 words today");
  await expect(meter.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

  // Leaving the document ends the session; it's stored and survives a reload.
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Library" }).click();
  await page.reload();
  await expect(meter.getByTestId("goal-progress")).toHaveText("7 / 6 words today");
  await expect(meter.getByTestId("streak")).toHaveText("1-day streak");

  // Nothing about sessions was sent to the server.
  const sent: string[] = [];
  page.on("request", (r) => r.method() !== "GET" && sent.push(r.url()));
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Goal test" }).click();
  await page.locator(".vl-prose").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Eight.");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Library" }).click();
  await expect(meter.getByTestId("goal-progress")).toHaveText("8 / 6 words today");
  expect(sent.filter((u) => /session|goal|insight/i.test(u))).toEqual([]);
});
