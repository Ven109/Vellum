import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

// No trailing separator: on Windows "C:\\app\\" would escape the closing quote of the argument.
const APP_DIR = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

let app: ElectronApplication;
let page: Page;
let userData: string;

async function launch() {
  app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "vellum-desktop-"));
  await launch();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

test("opens the app from its private origin, works offline, and keeps drafts", async () => {
  expect(page.url()).toMatch(/^app:\/\/vellum\//);
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  // No server: the desktop app is local-first, no sign-in screen.
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
  await expect(page.getByRole("table").getByRole("link", { name: "Welcome to Vellum" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "New draft" })
    .click();
  await page.getByRole("textbox", { name: "Title" }).fill("Written on the desktop");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.keyboard.type("Offline and fine.");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  const url = page.url();

  // Relaunch: the draft is still there.
  await app.close();
  await launch();
  await page.evaluate((u) => history.pushState(null, "", new URL(u).pathname), url);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Written on the desktop");
  await expect(page.locator(".vl-prose")).toHaveText("Offline and fine.");
});

test("the page is sandboxed: no Node, a minimal bridge, and no navigation away", async () => {
  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridge: Object.keys((window as unknown as { vellumDesktop: object }).vellumDesktop).sort(),
    secrets: Object.keys(
      (window as unknown as { vellumDesktop: { secrets: object } }).vellumDesktop.secrets,
    ).sort(),
  }));
  expect(exposed).toEqual({
    require: "undefined",
    process: "undefined",
    bridge: ["platform", "secrets"],
    secrets: ["delete", "get", "isEncryptionAvailable", "set"],
  });

  await page.evaluate(() => {
    window.location.href = "https://example.com/";
  });
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/^app:\/\/vellum\//);

  const csp = await page.evaluate(async () => (await fetch("/")).headers.get("content-security-policy"));
  expect(csp).toContain("script-src 'self'");
});

test("provider keys go to the OS keychain when there is one", async () => {
  const result = await page.evaluate(async () => {
    const s = (
      window as unknown as {
        vellumDesktop: {
          secrets: {
            isEncryptionAvailable(): Promise<boolean>;
            set(i: string, v: string): Promise<void>;
            get(i: string): Promise<string | null>;
            delete(i: string): Promise<void>;
          };
        };
      }
    ).vellumDesktop.secrets;
    const available = await s.isEncryptionAvailable();
    if (!available) {
      const refused = await s.set("provider-key:x", "secret").then(
        () => false,
        () => true,
      );
      return { available, refused };
    }
    await s.set("provider-key:test", "sk-test-123");
    const back = await s.get("provider-key:test");
    await s.delete("provider-key:test");
    return { available, back, gone: await s.get("provider-key:test") };
  });
  if (result.available) expect(result).toEqual({ available: true, back: "sk-test-123", gone: null });
  // Without a keychain (e.g. Linux with no keyring) the bridge refuses, and the app uses its own
  // encrypted store instead of saving keys in the clear.
  else expect(result).toEqual({ available: false, refused: true });
});
