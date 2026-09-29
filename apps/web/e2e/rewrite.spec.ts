import { expect, test } from "@playwright/test";
import { addAnthropicKey, mockAnthropic, selectText, newDraft } from "./fixtures.js";

test("rewrite shows a diff, and accept, try again and discard behave", async ({ page }) => {
  let attempt = 0;
  await mockAnthropic(page, (body) => {
    const last = body.messages.at(-1)!.content;
    if (last.includes("ready")) return "ready";
    attempt++;
    return attempt === 1 ? "a tool nobody mentions." : "a tool no one talks about.";
  });
  await addAnthropicKey(page);

  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Rewrite test");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Every workshop has one tool that nobody ever talks about.");
  const prose = page.locator(".vl-prose");

  await selectText(page, "one tool that nobody ever talks about.");
  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await expect(panel.getByTestId("attached-context")).toContainText("Selection · 7 words");
  await panel.getByRole("button", { name: "Tighten" }).click();

  const card = page.getByRole("dialog", { name: "Proposed rewrite" });
  await expect(card.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(prose).toContainText("mentions");
  // Not applied yet: the document text is unchanged.
  const docText = await page.evaluate(() => {
    const clone = document.querySelector(".vl-prose")!.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".vl-proposal-ins").forEach((n) => n.remove());
    return clone.textContent;
  });
  expect(docText).toBe("Every workshop has one tool that nobody ever talks about.");
  await expect(card.getByTestId("word-delta")).toContainText("words");

  await card.getByRole("button", { name: "Try again" }).click();
  await expect
    .poll(() =>
      prose
        .locator(".vl-proposal-ins")
        .allTextContents()
        .then((t) => t.join("|")),
    )
    .toContain("no");
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card).toHaveCount(0);
  await expect(prose).toHaveText("Every workshop has a tool no one talks about.");

  // Undo restores the original in one step.
  await prose.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose).toHaveText("Every workshop has one tool that nobody ever talks about.");

  // Discard leaves no trace.
  await selectText(page, "about.");
  await expect(panel.getByTestId("attached-context")).toContainText("Selection · 1 words");
  await panel.getByRole("button", { name: "Clarify" }).click();
  await expect(card.getByRole("button", { name: "Discard" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(prose.locator(".vl-proposal-ins")).toHaveCount(0);
  await expect(prose).toHaveText("Every workshop has one tool that nobody ever talks about.");
});

test("with inline rewrites off, the proposal shows in its card instead of the text", async ({ page }) => {
  await mockAnthropic(page, (body) =>
    body.messages.at(-1)!.content.includes("ready") ? "ready" : "a tool no one names.",
  );
  await addAnthropicKey(page);
  await page.goto("/settings/voice");
  await page.getByLabel("Show rewrites inline").uncheck();

  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Card only");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Every workshop has one tool that nobody ever talks about.");
  await selectText(page, "one tool that nobody ever talks about.");
  await page.keyboard.press("ControlOrMeta+j");
  await page
    .getByRole("complementary", { name: "Assistant" })
    .getByRole("button", { name: "Tighten" })
    .click();

  const card = page.getByRole("dialog", { name: "Proposed rewrite" });
  await expect(card.getByTestId("proposal-preview")).toHaveText("a tool no one names.");
  const inserts = page.locator(".vl-prose .vl-proposal-ins");
  await expect(inserts.first()).toBeAttached();
  for (const el of await inserts.all()) await expect(el).toBeHidden();
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".vl-prose")).toHaveText("Every workshop has a tool no one names.");
});
