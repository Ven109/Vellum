import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const MB = 1024 * 1024;
const dl = (name: string, digest?: string) => ({
  name,
  size: 118 * MB,
  browser_download_url: `https://github.com/Ven109/Vellum/releases/download/v1.2.0/${name}`,
  digest: digest ?? null,
});

const RELEASES = [
  {
    tag_name: "v1.3.0-beta.1",
    name: "Vellum 1.3.0 beta 1",
    body: "## New\n\n- Voice mode preview\n\n<script>window.pwned = true</script>",
    html_url: "https://github.com/Ven109/Vellum/releases/tag/v1.3.0-beta.1",
    published_at: "2026-09-20T10:00:00Z",
    prerelease: true,
    draft: false,
    assets: [],
  },
  {
    tag_name: "v1.2.0",
    name: "Vellum 1.2.0",
    body: "## Fixes\n\n- **Sync** no longer drops the last keystroke.\n- See [the docs](https://example.com/docs).",
    html_url: "https://github.com/Ven109/Vellum/releases/tag/v1.2.0",
    published_at: "2026-09-01T10:00:00Z",
    prerelease: false,
    draft: false,
    assets: [
      dl("Vellum-1.2.0-mac-arm64.dmg", "sha256:" + "a".repeat(64)),
      dl("Vellum-1.2.0-mac-x64.dmg", "sha256:" + "b".repeat(64)),
      dl("Vellum-1.2.0-win-x64.exe", "sha256:" + "c".repeat(64)),
      dl("Vellum-1.2.0-linux-x86_64.AppImage", "sha256:" + "d".repeat(64)),
      dl("Vellum-1.2.0-linux-amd64.deb"),
      dl("latest.yml"),
      dl("SHA256SUMS.txt"),
    ],
  },
];

async function mockGitHub(page: Page, releases: unknown = RELEASES, status = 200) {
  await page.route("https://api.github.com/**", (route) => {
    const url = route.request().url();
    if (url.includes("/releases")) return route.fulfill({ status, json: releases });
    return route.fulfill({ json: { stargazers_count: 321 } });
  });
}

test.describe("docs", () => {
  test.beforeEach(({ page }) => mockGitHub(page));

  test("an overview, then every page rendered from the repository", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Docs" }).click();
    await expect(page).toHaveURL(/\/docs\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Documentation");
    const nav = page.getByRole("navigation", { name: "Docs pages" });
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Self-hosting Vellum",
      "Accounts, workspaces and importing",
      "Desktop app",
      "AI providers",
      "Document format",
      "Contributing to Vellum",
      "Releasing",
    ]);

    await page
      .locator(".doc-cards")
      .getByRole("link", { name: /Self-hosting Vellum/ })
      .click();
    await expect(page).toHaveURL(/\/docs\/self-hosting\/$/);
    await expect(nav.getByRole("link", { name: "Self-hosting Vellum" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("./scripts/selfhost.sh").first()).toBeVisible();

    // Links between docs stay on the site.
    await page.locator(".prose").getByRole("link", { name: "ai-providers.md" }).first().click();
    await expect(page).toHaveURL(/\/docs\/ai-providers\/$/);
    for (const name of ["Anthropic", "OpenAI", "OpenAI-compatible endpoints", "Ollama"])
      await expect(page.getByRole("heading", { level: 3, name, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit this page on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Ven109/Vellum/blob/main/docs/ai-providers.md",
    );
  });
});

test.describe("download", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  });

  test("offers the build for your platform, with every build and its checksum", async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined }),
    );
    await mockGitHub(page);
    await page.goto("/download/");
    const primary = page.getByTestId("primary-download");
    await expect(primary).toHaveText("Download for macOS (Apple silicon)");
    await expect(primary).toHaveAttribute("href", /Vellum-1\.2\.0-mac-arm64\.dmg$/);
    // The stable release, not the newer beta.
    await expect(page.getByText(/Version 1\.2\.0, released September 1, 2026/)).toBeVisible();

    const rows = page.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(1)).toContainText("macOS");
    await expect(rows.nth(1)).toContainText("a".repeat(64));
    await expect(rows.nth(3)).toContainText("Windows");
    await expect(rows.nth(5)).toContainText("see SHA256SUMS.txt");
    await expect(page.getByRole("link", { name: "SHA256SUMS.txt" })).toHaveAttribute(
      "href",
      /SHA256SUMS\.txt$/,
    );
  });

  test("says so when there's no release yet or GitHub can't be reached", async ({ page }) => {
    await mockGitHub(page, []);
    await page.goto("/download/");
    await expect(page.getByText("No desktop release has been published yet.")).toBeVisible();
    await page.unrouteAll();
    await mockGitHub(page, { message: "rate limited" }, 403);
    await page.reload();
    await expect(page.getByText("We couldn't reach GitHub to find the latest release.")).toBeVisible();
    await expect(page.getByRole("link", { name: "GitHub Releases" })).toBeVisible();
  });
});

test.describe("changelog", () => {
  test("lists releases from GitHub with their notes, safely", async ({ page }) => {
    await mockGitHub(page);
    await page.goto("/changelog/");
    const releases = page.getByRole("article");
    await expect(releases).toHaveCount(2);
    await expect(releases.first().getByRole("heading", { level: 2 })).toHaveText("Vellum 1.3.0 beta 1 Beta");
    await expect(releases.first()).toContainText("Voice mode preview");
    // Raw HTML in notes is shown as text, never run.
    await expect(releases.first()).toContainText("<script>");
    expect(await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned)).toBeUndefined();
    await expect(releases.nth(1).locator("strong")).toHaveText("Sync");
    await expect(releases.nth(1).getByRole("link", { name: "On GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Ven109/Vellum/releases/tag/v1.2.0",
    );
  });

  test("falls back to GitHub when it can't load", async ({ page }) => {
    await mockGitHub(page, {}, 500);
    await page.goto("/changelog/");
    await expect(page.getByText("We couldn't load the releases from GitHub.")).toBeVisible();
  });
});

test("every page shares the nav and footer and fits a phone", async ({ page }) => {
  await mockGitHub(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/docs/", "/docs/self-hosting/", "/download/", "/changelog/"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Community" })).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }
});
