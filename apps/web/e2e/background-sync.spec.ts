import { expect, test } from "@playwright/test";
import { newDraft } from "./fixtures.js";

test("documents from other devices appear, and offline edits to closed documents sync later", async ({
  page,
  browser,
}) => {
  const title = `Written on device A ${Date.now()}`;
  // Device A writes a document.
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("First line from A.");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  const docPath = new URL(page.url()).pathname;

  // Device B (same account, fresh storage) lists it and can open it.
  const b = await browser.newContext({
    storageState: await page.context().storageState({ indexedDB: false }),
  });
  const pageB = await b.newPage();
  await pageB.goto("/library");
  await expect(pageB.getByRole("table").getByRole("link", { name: title })).toBeVisible();

  // A goes offline, edits, and closes the document before reconnecting.
  await page.context().setOffline(true);
  await page.locator(".vl-prose").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Added offline.");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Library" }).click();
  await page.waitForTimeout(1500); // the closed document's connection is gone by now
  await page.context().setOffline(false);

  // Background sync pushes it without the document being open; B sees it.
  await pageB.goto(docPath);
  await expect(pageB.locator(".vl-prose")).toHaveText("First line from A. Added offline.", {
    timeout: 20_000,
  });
  await b.close();
});
