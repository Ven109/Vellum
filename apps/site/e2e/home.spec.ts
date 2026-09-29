import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://api.github.com/repos/Ven109/Vellum", (route) =>
    route.fulfill({ json: { stargazers_count: 1234 } }),
  );
});

test("leads with self-hosting and your own key, with the repo and stars in the nav", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/open-source writing app you host yourself/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A quiet place to write, on your own server.",
  );
  await expect(page.getByText("Open source · AGPL-3.0 · Self-hostable")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Site" });
  const gh = nav.getByRole("link", { name: /Vellum on GitHub/ });
  await expect(gh).toHaveAttribute("href", "https://github.com/Ven109/Vellum");
  await expect(gh).toContainText("1.2k");
  await expect(gh).toHaveAttribute("aria-label", "Vellum on GitHub, 1,234 stars");

  await expect(page.getByRole("img", { name: /The Vellum editor/ })).toBeVisible();
  await expect(page.locator(".feature h3")).toHaveText([
    "Host it yourself",
    "Bring your own AI key",
    "Made for long-form",
  ]);
  await expect(page.getByText("./scripts/selfhost.sh")).toBeVisible();
});

test("pricing has no seats and says AI is billed by your own provider", async ({ page }) => {
  await page.goto("/#pricing");
  const pricing = page.getByRole("region", { name: "Pricing: none, really" });
  await expect(pricing.getByRole("article")).toHaveCount(3);
  await expect(pricing.getByRole("article", { name: "Your whole team" })).toContainText("$0 per seat");
  const note = pricing.getByRole("complementary", { name: "What about AI costs?" });
  await expect(note).toContainText("your provider bills you directly");
  await expect(note).toContainText("We don't sell AI");
});

test("without GitHub the nav still works, just without a count", async ({ page }) => {
  await page.unroute("https://api.github.com/repos/Ven109/Vellum");
  await page.route("https://api.github.com/**", (route) => route.fulfill({ status: 403, json: {} }));
  await page.goto("/");
  const gh = page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Vellum on GitHub" });
  await expect(gh).toBeVisible();
  await expect(gh.locator("[data-stars]")).toBeHidden();
});

test("works on a phone: a menu, no sideways scrolling, and big enough targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const nav = page.getByRole("navigation", { name: "Site" });
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(nav).toBeVisible();
  const box = await nav.getByRole("link", { name: "Pricing" }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await nav.getByRole("link", { name: "Pricing" }).click();
  await expect(nav).toBeHidden();
  await expect(page.getByRole("heading", { name: "Pricing: none, really" })).toBeInViewport();
});
