import { expect, test } from "@playwright/test";

test("command palette opens documents, splits, and creates drafts", async ({ page }) => {
  await page.goto("/library");
  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  await sidebar.getByRole("button", { name: "New draft" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Research notes");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();

  // Enter on no match creates a draft with that title.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("Fresh essay");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Fresh essay");

  // Cmd/Ctrl+Enter opens a document in split view beside the current one.
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("resnot");
  await expect(palette.getByRole("option", { name: /Research notes/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("region", { name: "Split: Research notes" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Primary document" }).getByRole("textbox", { name: "Title" }),
  ).toHaveValue("Fresh essay");

  await page.getByRole("button", { name: "Close split" }).click();
  await expect(page.getByRole("region", { name: "Split: Research notes" })).toHaveCount(0);
});
