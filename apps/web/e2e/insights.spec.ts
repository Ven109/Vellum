import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { newDraft } from "./fixtures.js";

const PROSE =
  "The morning was quiet. I sat by the window and wrote. The tea went cold. A bird sang in the tree outside. " +
  "Nothing much happened, and that was the point. The words came slowly at first, then all at once.";

test("insights: tiles, chart with goal days, breakdown, reading level, ranges and CSV", async ({ page }) => {
  await page.goto("/library");
  const meter = page.getByRole("region", { name: "Daily goal" });
  await meter.getByRole("button", { name: "Goal" }).click();
  await meter.getByLabel("Daily goal").fill("20");
  await meter.getByRole("button", { name: "Save" }).click();

  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Quiet morning");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type(PROSE);
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  await page.waitForTimeout(1000); // let the search index catch up

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Insights" }).click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.getByTestId("tile-words")).toHaveText("40");
  await expect(page.getByTestId("tile-average")).toHaveText("6"); // 40 / 7 days
  await expect(page.getByTestId("tile-streak")).toHaveText("1 day");

  const bars = page.getByTestId("bar");
  await expect(bars).toHaveCount(7);
  await expect(page.locator("[data-testid=bar][data-met]")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Words by collection" })).toContainText("Unfiled");
  await expect(page.getByTestId("reading-level")).toContainText(/Very easy|Easy/);
  await expect(page.getByTestId("reading-level")).toContainText("Quiet morning");

  await page.getByRole("radio", { name: "30 days" }).click();
  await expect(bars).toHaveCount(30);
  await page.getByRole("radio", { name: "Year" }).click();
  await expect(bars).toHaveCount(365);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^vellum-insights-.*\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8")
    .trim()
    .split("\n");
  expect(csv[0]).toBe("date,words,sessions,minutes,goal_met");
  expect(csv).toHaveLength(366);
  expect(csv.at(-1)).toMatch(/,40,1,\d+,yes$/);
});
