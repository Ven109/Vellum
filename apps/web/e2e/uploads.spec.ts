import { expect, test } from "@playwright/test";
import { newDraft } from "./fixtures.js";

// A 1×1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("pasting an image uploads it to the server's storage", async ({ page }) => {
  await page.goto("/library");
  await newDraft(page);
  await page.getByRole("textbox", { name: "Title" }).fill("With a picture");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Look:");

  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "dot.png", { type: "image/png" }));
    document
      .querySelector(".vl-prose")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG_BASE64);

  const img = page.locator(".vl-prose img:not(.ProseMirror-separator)");
  await expect(img).toHaveAttribute("src", /^\/files\/[a-z0-9]+\.png$/);
  await expect(img).toHaveAttribute("alt", "dot");
  const src = (await img.getAttribute("src"))!;
  const res = await page.request.get(src);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  // The image loaded in the page.
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
});
