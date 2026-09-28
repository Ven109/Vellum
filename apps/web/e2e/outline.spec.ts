import { expect, test } from "@playwright/test";

test("outline follows the document and the stats popover shows details", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New draft" }).click();
  await page.getByLabel("Title").fill("Long piece");
  await page.getByLabel("Title").press("Enter");

  const filler = Array.from(
    { length: 30 },
    () => "A paragraph of reasonable length to push content down.",
  ).join("\n\n");
  const markdown = ["## Opening", filler, "## Middle", filler, "## Ending", filler].join("\n\n");
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document
      .querySelector(".vl-prose")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, markdown);

  const outline = page.getByRole("complementary", { name: "Document details" });
  await expect(outline.getByRole("button", { name: "Ending" })).toBeVisible();
  await outline.getByRole("button", { name: "Ending" }).click();
  await expect(outline.getByRole("button", { name: "Ending" })).toHaveAttribute("aria-current", "true");
  await expect(outline.getByRole("button", { name: "Opening" })).not.toHaveAttribute("aria-current", "true");

  await page.getByTestId("word-count").click();
  const stats = page.getByRole("dialog", { name: "Document statistics" });
  await expect(stats).toContainText("Characters");
  await expect(stats).toContainText("min read");
});
