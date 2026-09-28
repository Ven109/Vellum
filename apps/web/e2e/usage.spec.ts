import { expect, test } from "@playwright/test";
import { addAnthropicKey, mockAnthropic, newDraft } from "./fixtures.js";

test("shows tokens and estimated cost per request, per session and per month", async ({ page }) => {
  let limited = true;
  await mockAnthropic(page, (body) => {
    const last = body.messages.at(-1)!.content;
    if (last.includes("ready")) return "ready";
    if (last.includes("limit me") && limited) {
      limited = false;
      return { status: 429, error: { type: "rate_limit_error", message: "slow down" }, retryAfter: 2 };
    }
    return "Short answer.";
  });
  await addAnthropicKey(page);
  await newDraft(page);
  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("complementary", { name: "Assistant" });

  await panel.getByLabel("Message the assistant").fill("Hello?");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByTestId("message-usage")).toContainText("20 in / 10 out");
  await expect(panel.getByTestId("message-usage")).toContainText("<$0.01");
  await expect(panel.getByTestId("usage-footer")).toContainText("This session: 30 tokens");

  // Rate limit: specific message and a retry that waits for the provider's retry-after.
  await panel.getByLabel("Message the assistant").fill("limit me");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByRole("alert")).toContainText("rate-limiting");
  await expect(panel.getByRole("button", { name: /Try again in \ds/ })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Try again" })).toBeEnabled({ timeout: 5000 });
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByText("limit me")).toBeVisible();
  await expect(panel.getByTestId("usage-footer")).toContainText("This session: 60 tokens");

  await page.goto("/settings/ai");
  await expect(page.getByRole("heading", { name: "Usage this month" })).toBeVisible();
  await expect(page.getByRole("row", { name: /claude-opus-5-5/ })).toBeVisible();
  await expect(page.getByText("billed by your provider, not by Vellum")).toBeVisible();
});
