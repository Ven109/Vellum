import { expect, test } from "@playwright/test";
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
