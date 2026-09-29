import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Simulate dropping files from the desktop onto the window. */
async function dropFiles(page: Page, files: Array<{ name: string; type: string; text: string }>) {
  const transfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: f.type }));
    return dt;
  }, files);
  const target = page.locator("main").first();
  await target.dispatchEvent("dragenter", { dataTransfer: transfer });
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(page.getByText("Drop to import")).toBeVisible();
  await target.dispatchEvent("drop", { dataTransfer: transfer });
}

test("drop Markdown files on the window to review and import them", async ({ page }) => {
  const title = `Dropped ${Date.now()}`;
  await page.goto("/library");
  await dropFiles(page, [
    { name: `${title}.md`, type: "text/markdown", text: `# ${title}\n\nFrom a *file* on disk.\n` },
    { name: "photo.bin", type: "application/octet-stream", text: "not a document" },
  ]);
  const dialog = page.getByRole("dialog", { name: "Import files" });
  await expect(dialog).toContainText("Import 1 draft");
  await expect(dialog).toContainText(title);
  await expect(page.getByText("Drop to import")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expect(page.locator(".vl-prose em")).toHaveText("file");
});

test("cancelling the review imports nothing", async ({ page }) => {
  const title = `Not imported ${Date.now()}`;
  await page.goto("/library");
  await dropFiles(page, [{ name: `${title}.md`, type: "text/markdown", text: `# ${title}\n` }]);
  const dialog = page.getByRole("dialog", { name: "Import files" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});
