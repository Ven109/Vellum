import { expect, test } from "@playwright/test";
import { newDraft, selectText } from "./fixtures.js";

test("suggesting mode records edits as proposals that can be accepted or dismissed", async ({ page }) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Suggestions");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Every workshop has one old tool.");

  await page
    .getByRole("radiogroup", { name: "Editing mode" })
    .getByRole("radio", { name: "Suggesting" })
    .click();
  await selectText(page, "old");
  await page.keyboard.type("quiet");
  await selectText(page, "Every");
  await page.keyboard.press("End");
  await page.keyboard.type(" Honestly.");

  const prose = page.locator(".vl-prose");
  await expect(prose.locator("del.vl-sug-del")).toHaveText("old");
  await expect(prose.locator("ins.vl-sug-ins").first()).toHaveText("quiet");
  const list = page.getByRole("region", { name: "Suggestions" });
  await expect(list.getByRole("article")).toHaveCount(2);
  await expect(list.getByRole("article").first()).toContainText("old → quiet");

  // Accept one, dismiss the other.
  await list.getByRole("article").first().getByRole("button", { name: "Accept" }).click();
  await expect(list.getByRole("article")).toHaveCount(1);
  await list.getByRole("article").first().getByRole("button", { name: "Dismiss" }).click();
  await expect(list.getByText("No pending suggestions.")).toBeVisible();
  await expect(prose).toHaveText("Every workshop has one quiet tool.");

  // Back in editing mode, typing changes text directly.
  await page
    .getByRole("radiogroup", { name: "Editing mode" })
    .getByRole("radio", { name: "Editing" })
    .click();
  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(prose).toHaveText("Every workshop has one quiet tool.!");
  await expect(list.getByText("No pending suggestions.")).toBeVisible();
});
