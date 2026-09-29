import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addAnthropicKey, mockAnthropic, selectText } from "./fixtures.js";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/**
 * Chromium has no on-screen keyboard, so stand in for the visual viewport and shrink it the way a
 * phone keyboard does.
 */
async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Set<() => void>();
    const vv = {
      width: window.innerWidth,
      height: window.innerHeight,
      offsetTop: 0,
      addEventListener: (_t: string, f: () => void) => listeners.add(f),
      removeEventListener: (_t: string, f: () => void) => listeners.delete(f),
    };
    Object.defineProperty(window, "visualViewport", { get: () => vv });
    (window as unknown as { __keyboard(h: number): void }).__keyboard = (h) => {
      vv.height = window.innerHeight - h;
      listeners.forEach((f) => f());
    };
  });
}

const keyboard = (page: Page, height: number) =>
  page.evaluate((h) => (window as unknown as { __keyboard(h: number): void }).__keyboard(h), height);

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
}

async function expectTouchTargets(page: Page, selector: string) {
  const sizes = await page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { label: el.getAttribute("aria-label") ?? el.textContent, w: r.width, h: r.height };
      }),
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) {
    expect.soft(s.w, `${s.label} width`).toBeGreaterThanOrEqual(44);
    expect.soft(s.h, `${s.label} height`).toBeGreaterThanOrEqual(44);
  }
}

test("navigation lives in a drawer and the editor uses the whole width", async ({ page }) => {
  await page.goto("/library");
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav).not.toBeInViewport();
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Open navigation" }).tap();
  await expect(nav).toBeInViewport();
  await nav.getByRole("button", { name: "New draft" }).tap();
  // Going somewhere closes the drawer.
  await expect(page).toHaveURL(/\/d\/doc_/);
  await expect(nav).not.toBeInViewport();

  // Compact top bar: save state, word count and the essentials; no breadcrumb, no rail.
  const topbar = page.locator(".vl-topbar");
  await expect(topbar.getByRole("status")).toBeVisible();
  await expect(topbar.getByTestId("word-count")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeHidden();
  await expect(page.getByRole("complementary", { name: "Document details" })).toBeHidden();
  await expectTouchTargets(page, ".vl-topbar button");

  const column = await page.locator(".vl-column").boundingBox();
  expect(column!.width).toBeGreaterThanOrEqual(388);
  await noHorizontalScroll(page);

  // History and focus mode are in the overflow menu.
  await topbar.getByRole("button", { name: "More" }).tap();
  await expect(page.getByRole("menuitem", { name: "Version history" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Focus mode" })).toBeVisible();
});

test("the formatting bar sits above the keyboard and formats without closing it", async ({ page }) => {
  await fakeKeyboard(page);
  await page.goto("/library");
  await page.getByRole("button", { name: "Open navigation" }).tap();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "New draft" }).tap();
  await page.getByRole("textbox", { name: "Title" }).fill("On the train");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");

  const bar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(bar).toBeVisible();
  await expectTouchTargets(page, ".vl-mobile-toolbar button");
  expect((await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBeCloseTo(844, 0);

  // The keyboard opens: the bar moves up with it.
  await keyboard(page, 336);
  await expect
    .poll(async () => Math.round((await bar.boundingBox())!.y + (await bar.boundingBox())!.height))
    .toBe(508);

  await bar.getByRole("button", { name: "Bold" }).tap();
  await expect(bar.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("Loud");
  await expect(page.locator(".vl-prose strong")).toHaveText("Loud");
  // The editor kept focus, so the keyboard would have stayed open.
  expect(await page.evaluate(() => document.activeElement?.closest(".vl-prose") !== null)).toBe(true);

  await bar.getByRole("button", { name: "Bold" }).tap();
  await page.keyboard.type(" and clear.");
  await bar.getByRole("button", { name: "Bulleted list" }).tap();
  await expect(page.locator(".vl-prose ul li")).toHaveText("Loud and clear.");
  await bar.getByRole("button", { name: "Undo" }).tap();
  await expect(page.locator(".vl-prose ul")).toHaveCount(0);

  // Hide the keyboard.
  await bar.getByRole("button", { name: "Hide keyboard" }).tap();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest(".vl-prose") != null))
    .toBe(false);
  await expect(bar.getByRole("button", { name: "Hide keyboard" })).toHaveCount(0);
  await keyboard(page, 0);
  await expect
    .poll(async () => Math.round((await bar.boundingBox())!.y + (await bar.boundingBox())!.height))
    .toBe(844);
});

test("a pending rewrite docks above the keyboard and formatting bar", async ({ page }) => {
  await mockAnthropic(page, (body) => {
    const last = body.messages.at(-1)!.content;
    return last.includes("ready") ? "ready" : "a tool nobody mentions.";
  });
  await fakeKeyboard(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await addAnthropicKey(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/library");
  await page.getByRole("button", { name: "Open navigation" }).tap();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "New draft" }).tap();
  await page.getByRole("textbox", { name: "Title" }).fill("Mobile rewrite");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Every workshop has one tool that nobody ever talks about.");
  await keyboard(page, 300);

  await selectText(page, "one tool that nobody ever talks about.");
  const bar = page.getByRole("toolbar", { name: "Formatting" });
  await bar.getByRole("button", { name: "Ask the assistant" }).tap();
  const sheet = page.getByRole("complementary", { name: "Assistant" });
  await expect(sheet).toBeInViewport();
  await sheet.getByRole("button", { name: "Tighten" }).tap();

  // The sheet steps aside and the card docks just above the bar.
  await expect(sheet).toHaveCount(0);
  const card = page.getByRole("dialog", { name: "Proposed rewrite" });
  await expect(card.getByRole("button", { name: "Accept" })).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(barBox.y);
  expect(barBox.y + barBox.height).toBeCloseTo(544, 0);
  expect(cardBox.x).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(390);
  await expectTouchTargets(page, ".vl-proposal-card button");

  await card.getByRole("button", { name: "Accept" }).tap();
  await expect(page.locator(".vl-prose")).toHaveText("Every workshop has a tool nobody mentions.");
});
