import { expect, test } from "@playwright/test";

test("library lists documents by status and opens them from the keyboard", async ({ page }) => {
  await page.goto("/library");
  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  await sidebar.getByRole("button", { name: "New draft" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Keyboard pick");
  await sidebar.getByRole("link", { name: "Library" }).click();

  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: "Keyboard pick" })).toBeVisible();
  await expect(table.getByRole("button", { name: /Draft/ })).toHaveAttribute("aria-expanded", "true");

  await page.getByLabel(/Use arrow keys/).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Keyboard pick");
});
