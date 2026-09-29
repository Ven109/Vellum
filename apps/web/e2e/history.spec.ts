import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newDraft } from "./fixtures.js";

interface V {
  id: string;
  reason: string;
  name?: string;
  author: { kind: string; userId?: string };
  stats: { wordCount: number };
}

test("snapshots on leaving a document, named versions from the palette, all attributed", async ({ page }) => {
  await page.goto("/library");
  await newDraft(page);
  const docId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
  await page.getByRole("textbox", { name: "Title" }).fill("History test");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Four words right here.");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();

  // A named version from the command palette.
  page.once("dialog", (d) => void d.accept("First pass"));
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("named version");
  await page.keyboard.press("Enter");

  const versions = async () =>
    (await (await page.request.get(`/api/documents/${docId}/versions`)).json()) as V[];
  await expect.poll(async () => (await versions()).map((v) => v.name ?? v.reason)).toContain("First pass");

  // Typing more, then leaving the document, takes an automatic snapshot.
  await page.locator(".vl-prose").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" And two more.");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Library" }).click();
  await expect.poll(async () => (await versions()).length).toBe(2);

  const [latest, named] = await versions();
  const me = (await (await page.request.get("/api/auth/me")).json()) as { user: { id: string } };
  expect(latest).toMatchObject({ reason: "autosave", author: { kind: "user", userId: me.user.id } });
  expect(latest!.stats.wordCount).toBe(7);
  expect(named).toMatchObject({ reason: "named", name: "First pass", stats: { wordCount: 4 } });
});

async function nameVersion(page: Page, name: string) {
  page.once("dialog", (d) => void d.accept(name));
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("named version");
  await page.keyboard.press("Enter");
}

test("history screen: timeline, three views, restore and copy as a new draft", async ({ page }) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Timeline test");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("The first sentence stays.");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  await nameVersion(page, "Opening");
  await page.locator(".vl-prose").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" A second sentence arrives.");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  await nameVersion(page, "Expanded");

  await page.getByRole("button", { name: "Version history" }).click();
  await expect(page).toHaveURL(/\/history$/);
  const timeline = page.getByRole("navigation", { name: "Versions" });
  await expect(timeline.getByRole("region", { name: "Today" })).toBeVisible();
  const items = timeline.getByRole("button");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Expanded");
  await expect(items.first()).toContainText("You");
  await expect(items.first()).toContainText("+4");
  await expect(items.nth(1)).toContainText("Opening");

  // Changes: additions highlighted inline.
  const changes = page.getByTestId("diff-changes");
  await expect(changes.locator("ins")).toContainText("A second sentence arrives.");
  await expect(changes.locator("del")).toHaveCount(0);

  // Side by side and clean.
  await page.getByRole("radio", { name: "Side by side" }).click();
  await expect(page.getByRole("region", { name: "Before" })).toContainText("The first sentence stays.");
  await expect(page.getByRole("region", { name: "Before" })).not.toContainText("second");
  await expect(page.getByRole("region", { name: "After" }).locator("ins")).toContainText("second sentence");
  await page.getByRole("radio", { name: "Clean" }).click();
  await expect(page.getByTestId("diff-clean")).toHaveText(
    "The first sentence stays. A second sentence arrives.",
  );

  // Restore the opening version.
  await items.nth(1).click();
  await expect(page.getByRole("region", { name: "Selected version" }).getByRole("heading")).toHaveText(
    "Opening",
  );
  await page.getByRole("button", { name: "Restore this version" }).click();
  await expect(page).not.toHaveURL(/\/history$/);
  await expect(page.locator(".vl-prose")).toHaveText("The first sentence stays.");

  // The restore is itself in history, with what was there before it kept.
  await page.getByRole("button", { name: "Version history" }).click();
  await expect(items.first()).toContainText("Restored");
  await expect(items).toHaveCount(3);

  // Copy an older version into a new draft.
  await items.filter({ hasText: "Expanded" }).click();
  await page.getByRole("button", { name: "Copy as new draft" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Timeline test (copy)");
  await expect(page.locator(".vl-prose")).toHaveText("The first sentence stays. A second sentence arrives.");
});
