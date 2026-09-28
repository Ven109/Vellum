import { expect, test } from "@playwright/test";
import { addAnthropicKey, mockAnthropic, newDraft } from "./fixtures.js";

test("assistant explains it needs a key when none is configured", async ({ page }) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await expect(panel.getByText("Add your own API key to use the assistant")).toBeVisible();
  await panel.getByRole("button", { name: "Set up a provider" }).click();
  await expect(page).toHaveURL(/\/settings\/ai$/);
});

test("chats about the draft with visible grounding and recovers from errors", async ({ page }) => {
  let failNext = false;
  const seen = await mockAnthropic(page, (body) => {
    if (failNext) {
      failNext = false;
      return { status: 429, error: { type: "rate_limit_error", message: "slow down" } };
    }
    const last = body.messages[body.messages.length - 1]!.content;
    if (last.includes("ready")) return "ready";
    return body.system?.includes("<selection>")
      ? "That sentence is clear."
      : "Your draft is about workshops.";
  });
  await addAnthropicKey(page);

  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Workshops");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Every workshop has one tool nobody talks about.");

  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await expect(panel.getByTestId("attached-context")).toContainText("Whole draft");
  await panel.getByLabel("Message the assistant").fill("What is this about?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("Your draft is about workshops.")).toBeVisible();
  await expect(panel.getByLabel("Grounded in")).toContainText("Whole draft: Workshops");
  expect(JSON.stringify(seen.at(-1)!.body)).toContain("Every workshop has one tool nobody talks about.");

  // Selecting text switches the attached context to the selection.
  await page.getByText("nobody").dblclick();
  await expect(panel.getByTestId("attached-context")).toContainText("Selection · 1 words");
  await panel.getByLabel("Message the assistant").fill("Is this clear?");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByText("That sentence is clear.")).toBeVisible();

  // A rate limit shows a specific message and a retry that keeps the question.
  failNext = true;
  await panel.getByLabel("Message the assistant").fill("One more?");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByRole("alert")).toContainText("rate-limiting");
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByText("One more?")).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
});
