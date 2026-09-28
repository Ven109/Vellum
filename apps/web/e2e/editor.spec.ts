import { expect, test } from "@playwright/test";

test("write in a new draft and keep it after reload", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("main").getByRole("link", { name: "Welcome to Vellum" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Vellum");

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "New draft" })
    .click();
  await page.getByRole("textbox", { name: "Title" }).fill("On workshops");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("## The quiet tool");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Every workshop has one tool nobody talks about.");

  await expect(page.getByTestId("word-count")).toHaveText("11 words");
  await expect(page.getByRole("heading", { name: "The quiet tool" })).toBeVisible();
  await expect(page.getByRole("complementary").getByRole("button", { name: "The quiet tool" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "On workshops" }),
  ).toBeVisible();

  // Select a word to reveal the floating toolbar.
  await page.getByText("nobody").dblclick();
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" }).click();
  await expect(page.locator(".vl-prose strong")).toHaveText("nobody");

  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("On workshops");
  await expect(page.locator(".vl-prose strong")).toHaveText("nobody");
});
