import { expect, test } from "@playwright/test";
import { newDraft, selectText } from "./fixtures.js";

test("review panel: tabs for open comments, suggestions and resolved, and approving the draft", async ({
  page,
}) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("For review");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("A draft with one weak word.");

  await selectText(page, "weak");
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Comment" }).click();
  await page.getByRole("dialog", { name: "New comment" }).getByLabel("Comment").fill("Stronger word?");
  await page.getByRole("dialog", { name: "New comment" }).getByRole("button", { name: "Comment" }).click();

  await page
    .getByRole("radiogroup", { name: "Editing mode" })
    .getByRole("radio", { name: "Suggesting" })
    .click();
  await selectText(page, "weak");
  await page.keyboard.type("strong");

  await page.getByRole("button", { name: /^Review/ }).click();
  const review = page.getByRole("complementary", { name: "Review" });
  await expect(review.getByRole("tab", { name: "Open (1)" })).toBeVisible();
  await expect(review.getByRole("tab", { name: "Suggestions (1)" })).toBeVisible();

  await review.getByRole("tab", { name: "Suggestions (1)" }).click();
  await expect(review.getByRole("article")).toContainText("weak → strong");
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review.getByRole("tab", { name: "Suggestions (0)" })).toBeVisible();
  await expect(page.locator(".vl-prose")).toHaveText("A draft with one strong word.");

  await review.getByRole("tab", { name: /^Open/ }).click();
  await review.getByRole("article").click();
  await review.getByRole("button", { name: "Resolve" }).click();
  await expect(review.getByRole("tab", { name: "Resolved (1)" })).toBeVisible();

  await review.getByRole("button", { name: "Approve draft" }).click();
  await review.getByRole("alert").getByRole("button", { name: "Approve" }).click();
  await expect(review.getByText("Draft approved")).toBeVisible();

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("row", { name: /For review/ })).toContainText("Approved");
});
