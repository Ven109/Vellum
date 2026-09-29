import { expect, test } from "@playwright/test";
import { newDraft, selectText } from "./fixtures.js";

test("comment threads anchor to text, survive edits, and detach when the text is deleted", async ({
  page,
}) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Commented");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Every workshop has one tool nobody talks about.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A second paragraph to delete later.");

  await selectText(page, "one tool");
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Comment" }).click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  await composer.getByLabel("Comment").fill("Which tool? Ask @Ada Admin");
  await composer.getByRole("button", { name: "Comment" }).click();

  const rail = page.getByRole("region", { name: "Comments" });
  const card = rail.getByRole("article", { name: /Comment on “one tool”/ });
  await expect(card).toBeVisible();
  await expect(card.locator(".vl-mention")).toHaveText("@Ada Admin");
  await expect(page.locator(".vl-prose .vl-comment-active")).toHaveText("one tool");

  // Editing before the anchor keeps it attached to the same words.
  await page.locator(".vl-prose p").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.type("Honestly, ");
  await expect(page.locator(".vl-prose [data-annotation-id^='thr_']")).toHaveText("one tool");

  // Reply and resolve.
  await card.getByLabel("Reply").fill("The marking gauge.");
  await card.getByLabel("Reply").press("Enter");
  await expect(card).toContainText("The marking gauge.");
  await card.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator(".vl-prose [data-annotation-id^='thr_']")).toHaveCount(0);
  await rail.getByRole("button", { name: /Show 1 resolved/ }).click();
  await rail.getByRole("article").first().click();
  await rail.getByRole("button", { name: "Reopen" }).click();
  await expect(page.locator(".vl-prose [data-annotation-id^='thr_']")).toHaveText("one tool");

  // A thread on text that is deleted is kept, detached.
  await selectText(page, "to delete later");
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Comment" }).click();
  await composer.getByLabel("Comment").fill("Cut this?");
  await composer.getByRole("button", { name: "Comment" }).click();
  await selectText(page, "A second paragraph to delete later.");
  await page.keyboard.press("Backspace");
  await expect(rail.getByText("Detached")).toBeVisible({ timeout: 5000 });
  await expect(rail.getByText("The text this was about was deleted.")).toBeVisible();

  // Threads persist with the document.
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Comments" }).getByRole("article", { name: /one tool/ }),
  ).toBeVisible();
});
