import { expect, test } from "@playwright/test";
import { newDraft } from "./fixtures.js";

test("command palette opens documents, splits, and creates drafts", async ({ page }) => {
  // Other tests share the server, so the fuzzy query must only match this test's document.
  const tag = Date.now().toString().slice(-5);
  const notes = `Research notes ${tag}`;
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill(notes);
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();

  // Enter on no match creates a draft with that title.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("Fresh essay");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Fresh essay");

  // Cmd/Ctrl+Enter opens a document in split view beside the current one.
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill(`resnot${tag}`);
  await expect(palette.getByRole("option", { name: new RegExp(notes) })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("region", { name: `Split: ${notes}` })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Primary document" }).getByRole("textbox", { name: "Title" }),
  ).toHaveValue("Fresh essay");

  await page.getByRole("button", { name: "Close split" }).click();
  await expect(page.getByRole("region", { name: `Split: ${notes}` })).toHaveCount(0);
});
