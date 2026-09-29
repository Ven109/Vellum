import { expect, test } from "@playwright/test";
import { ADMIN } from "./global-setup.js";
import { newDraft } from "./fixtures.js";

test("settings shell: profile, house rules with an unsaved-changes guard, behaviour switches", async ({
  page,
}) => {
  await page.goto("/library");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Settings" }).click();
  const settingsNav = page.getByRole("navigation", { name: "Settings" });
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
  await expect(page.getByText("Signed in as ada@example.com")).toBeVisible();

  // Rename yourself.
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  // House rules: unsaved changes are guarded.
  await settingsNav.getByRole("link", { name: "Voice and style" }).click();
  const rules = page.getByRole("textbox", { name: "House rules" });
  await rules.fill("Use British spelling.\nNo exclamation marks.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  page.once("dialog", (d) => {
    expect(d.message()).toContain("unsaved house rules");
    void d.dismiss();
  });
  await settingsNav.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/settings\/voice$/);
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("2 rules")).toBeVisible();
  await expect(page.getByTestId("last-edited")).toContainText("Last edited by you");
  await settingsNav.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);

  // Repeated phrasing is flagged while the switch is on, and not when it's off.
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Repeats");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("At the end of the day we shipped. At the end of the day, nobody minded.");
  await expect(page.locator(".vl-prose .vl-repeat").first()).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Settings" }).click();
  await settingsNav.getByRole("link", { name: "Voice and style" }).click();
  await page.getByLabel("Flag repeated phrasing").uncheck();
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Repeats");
  await expect(page.locator(".vl-prose")).toContainText("nobody minded");
  await expect(page.locator(".vl-prose .vl-repeat")).toHaveCount(0);

  // Other tests expect the admin's original name.
  expect((await page.request.patch("/api/auth/me", { data: { name: ADMIN.name } })).ok()).toBeTruthy();
});
