import { expect, test } from "@playwright/test";

test("full-text search finds words in document bodies", async ({ page }) => {
  await page.goto("/library");
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "New draft" })
    .click();
  await page.getByRole("textbox", { name: "Title" }).fill("Breakfast");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Seville oranges make the best marmalade in January.");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  await page.waitForTimeout(1200); // indexing is debounced

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("marmal");
  const hit = palette.getByRole("option", { name: /Breakfast/ });
  await expect(hit).toContainText("best marmalade in January");

  // The index survives a reload (it is persisted locally).
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Breakfast");
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("seville");
  await expect(palette.getByRole("option", { name: /Breakfast/ })).toBeVisible();
});
