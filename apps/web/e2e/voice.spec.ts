import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addAnthropicKey, mockAnthropic, newDraft } from "./fixtures.js";

async function pasteText(page: Page, text: string) {
  await page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    document
      .querySelector(".vl-prose")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, text);
}

const TERSE = Array.from(
  { length: 12 },
  (_, i) => `The bench was cold. I planed the board. Shavings curled. The light held. I kept going ${i}.`,
).join("\n\n");
const FLORID = Array.from(
  { length: 12 },
  () => "Honestly, it was incredibly, wonderfully, extraordinarily quiet — really and truly quiet!",
).join("\n\n");

test("learns voice traits from published pieces only and injects them into rewrites", async ({ page }) => {
  const seen = await mockAnthropic(page, (b) =>
    b.messages.at(-1)!.content.includes("ready") ? "ready" : "Fine.",
  );
  await addAnthropicKey(page);

  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Published piece");
  await page.locator(".vl-prose").click();
  await pasteText(page, TERSE);
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();

  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Messy draft");
  await page.locator(".vl-prose").click();
  await pasteText(page, FLORID);
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
  await page.waitForTimeout(800);

  // Publish only the first piece.
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Library" }).click();
  await page.getByRole("checkbox", { name: "Select Published piece" }).check();
  await page.getByRole("region", { name: "Bulk actions" }).getByLabel("Set status").selectOption("published");

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Voice and style" })
    .click();
  const traits = page.getByRole("list", { name: "Voice traits" });
  await expect(traits.getByText("Short sentences")).toBeVisible();
  await expect(page.getByTestId("voice-source")).toContainText("Learned from 1 published piece");
  await expect(traits.getByText("Adverb-friendly")).toHaveCount(0);

  // Edit a trait; the edit is what gets sent.
  await traits.getByRole("button", { name: "Edit" }).first().click();
  await traits.getByLabel(/Instruction for/).fill("Write in clipped, short sentences.");
  await traits.getByRole("button", { name: "Save" }).click();

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Messy draft" })
    .click();
  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await panel.getByLabel("Message the assistant").fill("Thoughts?");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByText("Fine.")).toBeVisible();
  await expect(panel.getByLabel("Grounded in")).toContainText("Voice profile");
  const system = (seen.at(-1)!.body as { system: string }).system;
  expect(system).toContain("<voice_profile>");
  expect(system).toContain("Write in clipped, short sentences.");

  // Switching learning off stops the profile being used.
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Voice and style" })
    .click();
  await page.getByLabel(/Learn from pieces I’ve marked/).uncheck();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Messy draft" })
    .click();
  await panel.getByLabel("Message the assistant").fill("Again?");
  await panel.getByLabel("Message the assistant").press("Enter");
  await expect(panel.getByText("Fine.").nth(1)).toBeVisible();
  expect((seen.at(-1)!.body as { system: string }).system).not.toContain("<voice_profile>");
});
