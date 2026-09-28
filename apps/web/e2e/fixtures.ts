import type { Page } from "@playwright/test";

/** Create a draft from the sidebar and wait until its (empty) editor is showing. */
export async function newDraft(page: Page) {
  const before = page.url();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "New draft" })
    .click();
  await page.waitForURL((url) => url.toString() !== before && url.pathname.startsWith("/d/"));
  await page.waitForFunction(
    () => (document.querySelector(".vl-title") as HTMLTextAreaElement | null)?.value === "",
  );
}
