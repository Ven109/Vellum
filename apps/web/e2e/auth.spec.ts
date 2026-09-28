import { expect, test } from "@playwright/test";
import { ADMIN } from "./global-setup.js";

const signedOut = { storageState: { cookies: [], origins: [] } };

test("an admin invites a writer, who joins and can sign out and back in", async ({ page, browser }) => {
  await page.goto("/settings/workspace");
  await expect(page.getByText(`Signed in as ${ADMIN.name}`)).toBeVisible();
  await page.getByLabel("Email to invite").fill("wren@example.com");
  await page.getByRole("button", { name: "Invite" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:5173\/invite\//);
  await expect(page.getByRole("list", { name: "Pending invites" })).toContainText("wren@example.com");

  const ctx = await browser.newContext(signedOut);
  const wren = await ctx.newPage();
  await wren.goto(link);
  await expect(wren.getByRole("heading", { name: "Join Main" })).toBeVisible();
  await expect(wren.getByText(`${ADMIN.name} invited you to join`)).toBeVisible();
  await wren.getByLabel("Your name").fill("Wren");
  await wren.getByLabel("Email").fill("wren@example.com");
  await wren.getByLabel("Password").fill("wren's long password");
  await wren.getByRole("button", { name: "Create account" }).click();
  await wren.waitForURL("**/library");
  await expect(wren.getByRole("button", { name: /Main/ }).first()).toBeVisible();

  // The admin sees the new member.
  await page.reload();
  await expect(page.getByRole("list", { name: "Members" })).toContainText("Wren");

  // Sign out, a wrong password, then back in.
  await wren.goto("/settings/workspace");
  await wren.getByRole("button", { name: "Sign out" }).click();
  await expect(wren.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await wren.getByLabel("Email").fill("wren@example.com");
  await wren.getByLabel("Password").fill("not my password");
  await wren.getByRole("button", { name: "Sign in" }).click();
  await expect(wren.getByRole("alert")).toHaveText("Email or password is incorrect.");
  await wren.getByLabel("Password").fill("wren's long password");
  await wren.getByRole("button", { name: "Sign in" }).click();
  await wren.waitForURL("**/library");
  await ctx.close();
});

test("sign-up is invite-only by default and password reset doesn't reveal accounts", async ({ browser }) => {
  const ctx = await browser.newContext(signedOut);
  const page = await ctx.newPage();
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Sign-up is invite-only" })).toBeVisible();

  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await ctx.close();
});

test("imports Markdown files as drafts in collections", async ({ page }) => {
  await page.goto("/settings/workspace");
  await page.getByLabel("Files to import").setInputFiles([
    {
      name: "field-notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "---\ntitle: Field notes\n---\n\n## Morning\n\nThe *light* was [thin](https://example.com).\n",
      ),
    },
  ]);
  const review = page.getByTestId("import-review");
  await expect(review).toContainText("Ready to import 1 draft");
  await expect(review).toContainText("Field notes");
  await review.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported 1 draft.")).toBeVisible();

  await page.getByRole("button", { name: "Open the library" }).click();
  await page.getByRole("table").getByRole("link", { name: "Field notes" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Field notes");
  const prose = page.locator(".vl-prose");
  await expect(prose.locator("h2")).toHaveText("Morning");
  await expect(prose.locator("em")).toHaveText("light");
  await expect(prose.locator("a")).toHaveAttribute("href", "https://example.com");
});
