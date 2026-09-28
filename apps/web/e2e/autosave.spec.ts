import { expect, test } from "@playwright/test";
import { newDraft } from "./fixtures.js";

test("autosaves to the server, survives going offline, and syncs on reconnect", async ({ context, page }) => {
  await page.goto("/");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Autosave");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("First line typed online.");
  const status = page.getByRole("status").filter({ hasText: /Saved|Saving|Offline/ });
  await expect(status).toHaveText("Saved");
  const url = page.url();

  // A second tab on the same document receives edits through the server.
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.locator(".vl-prose")).toContainText("First line typed online.");

  // Lose the connection: edits keep landing locally and the top bar says so.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(status).toHaveText("Offline", { timeout: 15_000 });
  await page.locator(".vl-prose").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Written while offline.");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(status).toHaveText("Saved", { timeout: 15_000 });
  await expect(other.locator(".vl-prose")).toContainText("Written while offline.");
});
