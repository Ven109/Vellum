import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { addAnthropicKey, mockAnthropic, newDraft, selectText } from "./fixtures.js";

test("editor preferences change the page and are remembered", async ({ page }) => {
  await page.goto("/settings/editor");
  await page.getByRole("radio", { name: "Mono" }).click();
  await page.getByRole("radio", { name: "Wide" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByLabel("Check spelling").uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/library");
  await newDraft(page);
  const docUrl = page.url();
  const prose = page.locator(".vl-prose");
  await expect(prose).toHaveCSS("font-family", /mono|Menlo|Consolas/i);
  await expect(prose).toHaveAttribute("spellcheck", "false");
  await expect(page.locator(".vl-column")).toHaveCSS("max-width", /px$/);
  const wide = await page.locator(".vl-column").evaluate((el) => getComputedStyle(el).maxWidth);

  await page.reload();
  await expect(prose).toHaveAttribute("spellcheck", "false");
  await page.goto("/settings/editor");
  await expect(page.getByRole("radio", { name: "Wide" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Narrow" }).click();
  await page.getByRole("radio", { name: "System" }).click();
  await page.goto(docUrl);
  const narrow = await page.locator(".vl-column").evaluate((el) => getComputedStyle(el).maxWidth);
  expect(parseFloat(narrow)).toBeLessThan(parseFloat(wide));

  await page.goto("/settings/shortcuts");
  await expect(page.getByRole("region", { name: "Anywhere" })).toContainText("Command palette");
});

test("the assistant says when a house rule changed its output", async ({ page }) => {
  const seen = await mockAnthropic(page, (body) =>
    body.messages.at(-1)!.content.includes("ready") ? "ready" : "a colour nobody names.\n[rules: 1]",
  );
  await addAnthropicKey(page);
  await page.goto("/settings/voice");
  await page
    .getByRole("textbox", { name: "House rules" })
    .fill("Use British spelling.\nNo exclamation marks.");
  await page.getByRole("button", { name: "Save rules" }).click();

  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Rules");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Every workshop has one color nobody talks about.");
  await selectText(page, "one color nobody talks about.");
  await page.keyboard.press("ControlOrMeta+j");
  await page
    .getByRole("complementary", { name: "Assistant" })
    .getByRole("button", { name: "Tighten" })
    .click();

  const card = page.getByRole("dialog", { name: "Proposed rewrite" });
  await expect(card.getByTestId("rules-applied")).toHaveText("House rule applied: Use British spelling.");
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".vl-prose")).toHaveText("Every workshop has a colour nobody names.");
  const system = (seen.at(-1)!.body as { system: string }).system;
  expect(system).toContain("1. Use British spelling.\n2. No exclamation marks.");
});

test("export the workspace as portable files and import it back", async ({ page }) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Backed up");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Keep this safe.");
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();

  await page.goto("/settings/export");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export as .zip" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^main-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = (await download.path())!;
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const names = Object.keys(files);
  expect(names).toEqual(
    expect.arrayContaining([
      "vellum.json",
      "README.md",
      "unfiled/backed-up.md",
      "essays/welcome-to-vellum.md",
    ]),
  );
  const md = new TextDecoder().decode(files["unfiled/backed-up.md"]);
  expect(md).toMatch(/^---\ntitle: "Backed up"\nstatus: draft\n/);
  expect(md).toContain("# Backed up\n\nKeep this safe.");

  await page
    .getByLabel("Files to import")
    .setInputFiles({ name: "backup.zip", mimeType: "application/zip", buffer: readFileSync(path) });
  await expect(page.getByTestId("import-review")).toContainText("Ready to import 2 drafts");
  await page.getByTestId("import-review").getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported 2 drafts.")).toBeVisible();
  await page.goto("/library");
  await expect(page.getByRole("table").getByRole("link", { name: "Backed up" })).toHaveCount(2);
});
