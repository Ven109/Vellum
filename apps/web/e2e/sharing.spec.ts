import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ADMIN } from "./global-setup.js";
import { newDraft, selectText } from "./fixtures.js";

/** A second person with their own account, outside the admin's workspace. */
async function outsider(browser: Browser, page: Page, name: string, email: string): Promise<Page> {
  await page.request.patch("/api/admin/settings", { data: { signupsEnabled: true } });
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const res = await ctx.request.post("/api/auth/signup", {
    data: { name, email, password: `${name.toLowerCase()}'s long password` },
  });
  expect(res.ok()).toBeTruthy();
  await page.request.patch("/api/admin/settings", { data: { signupsEnabled: false } });
  return ctx.newPage();
}

test("share with a commenter, see each other's presence, and upgrade by link", async ({ page, browser }) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Shared essay");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Every notebook is a map of attention.");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  const docUrl = page.url();

  const vic = await outsider(browser, page, "Vic", "vic@example.com");

  // Before sharing, Vic can't open it.
  await vic.goto(docUrl);
  await expect(vic.getByText(/doesn.t exist or was deleted/)).toBeVisible();

  // Share as a commenter.
  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share" });
  await dialog.getByLabel("Email to share with").fill("nobody@example.com");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Invite them to the workspace first");
  await dialog.getByLabel("Email to share with").fill("vic@example.com");
  await dialog.getByLabel("Role for new person").selectOption("comment");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "People with access" })).toContainText("Vic");
  await expect(dialog.getByText("Mark this piece Published")).toBeVisible();

  // Vic finds it under Shared with me, reads it, and can't type into it.
  await vic.goto("/library");
  await vic.getByRole("list", { name: "Shared with me" }).getByRole("link", { name: "Shared essay" }).click();
  await expect(vic.locator(".vl-prose")).toHaveText("Every notebook is a map of attention.");
  await expect(vic.getByTestId("role-badge")).toHaveText("Commenting");
  await expect(vic.locator(".vl-prose")).toHaveAttribute("contenteditable", "false");
  await expect(vic.getByRole("textbox", { name: "Title" })).toHaveAttribute("readonly", "");

  // Presence: each sees the other, and the admin's cursor shows up for Vic.
  await expect(page.getByRole("list", { name: "People in this document" }).getByTitle("Vic")).toBeVisible();
  await expect(
    vic.getByRole("list", { name: "People in this document" }).getByTitle(ADMIN.name),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".vl-prose").click();
  await page.keyboard.press("End");
  await expect(vic.locator(".ProseMirror-yjs-cursor")).toContainText(ADMIN.name);

  // Live edits reach Vic.
  await page.keyboard.type(" Keep it.");
  await expect(vic.locator(".vl-prose")).toContainText("map of attention. Keep it.");

  // Commenting is allowed, and the admin sees it.
  await selectText(vic, "map of attention");
  await vic.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Comment" }).click();
  const composer = vic.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Comment").fill("Lovely line.");
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(
    page.getByRole("region", { name: "Comments" }).getByRole("article", { name: /map of attention/ }),
  ).toContainText("Lovely line.");
  await expect(vic.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();

  // A suggest link upgrades Vic's access.
  await page.getByRole("button", { name: "Share" }).click();
  await dialog.getByLabel("Link role").selectOption("suggest");
  await dialog.getByLabel("Link expires after").selectOption("1");
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = await dialog.getByLabel("Share link").inputValue();
  expect(link).toMatch(/\/s\//);
  await expect(dialog.getByRole("list", { name: "Active links" })).toContainText("Can suggest");

  await vic.goto(link);
  await expect(vic.getByText(`${ADMIN.name} shared Shared essay with you`)).toBeVisible();
  await vic.getByRole("button", { name: "Open document" }).click();
  await expect(vic.getByTestId("role-badge")).toHaveText("Suggesting");
  await expect(vic.locator(".vl-prose")).toHaveAttribute("contenteditable", "true");
  await vic.context().close();
});

test("a published piece gets a public read-only page", async ({ page }) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Public piece");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Read me, **world**.");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  const docUrl = page.url();

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Library" }).click();
  await page.getByRole("checkbox", { name: "Select Public piece" }).check();
  await page.getByRole("region", { name: "Bulk actions" }).getByLabel("Set status").selectOption("published");
  await page.goto(docUrl);

  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share" });
  await dialog.getByLabel("Anyone with the link can read this piece").click();
  await expect(dialog.getByLabel("Public link")).toBeVisible();
  const url = await dialog.getByLabel("Public link").inputValue();

  const res = await page.request.get(url, { headers: { cookie: "" } });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("<h1>Public piece</h1>");
  expect(html).toContain("<strong>world</strong>");

  await dialog.getByLabel("Anyone with the link can read this piece").click();
  await expect(dialog.getByLabel("Public link")).toBeHidden();
  expect((await page.request.get(url)).status()).toBe(404);
});
