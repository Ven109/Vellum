import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

interface UpdateSettings {
  autoUpdate: boolean;
  channel: string;
  managed: boolean;
}
declare global {
  interface Window {
    vellumDesktop?: {
      openWindow?(path: string): Promise<void>;
      updates?: {
        getSettings(): Promise<UpdateSettings>;
        setSettings(patch: Partial<UpdateSettings>): Promise<UpdateSettings>;
      };
    };
  }
}

// No trailing separator: on Windows "C:\\app\\" would escape the closing quote of the argument.
const APP_DIR = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

let app: ElectronApplication;
let page: Page;
let userData: string;

async function launch(env: Record<string, string> = {}) {
  app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0", VELLUM_NO_PROTOCOL: "1", ...env },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  // The first launch offers setup (covered in desktop.spec.ts).
  const nav = page.getByRole("navigation", { name: "Workspace" });
  const skip = page.getByRole("button", { name: "Skip setup" });
  await expect(nav.or(skip)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(nav).toBeVisible();
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), "vellum-native-"));
  await launch();
});

test.afterEach(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

const docId = (url: string) => /\/d\/(doc_[0-9a-z]+)/.exec(url)?.[1];

test("native menus drive the app: New Draft, palette and Help", async () => {
  const labels = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()!;
    return ["new-draft", "new-window", "import", "palette", "focus", "check-updates", "docs"].map((id) => ({
      id,
      label: menu.getMenuItemById(id)?.label,
      accelerator: menu.getMenuItemById(id)?.accelerator ?? null,
    }));
  });
  expect(labels).toEqual([
    { id: "new-draft", label: "New Draft", accelerator: "CmdOrCtrl+N" },
    { id: "new-window", label: "New Window", accelerator: "Shift+CmdOrCtrl+N" },
    { id: "import", label: "Import…", accelerator: "CmdOrCtrl+O" },
    { id: "palette", label: "Command Palette", accelerator: "CmdOrCtrl+K" },
    { id: "focus", label: "Focus Mode", accelerator: "Shift+CmdOrCtrl+F" },
    { id: "check-updates", label: "Check for Updates…", accelerator: null },
    { id: "docs", label: "Vellum Help", accelerator: null },
  ]);

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("new-draft")!.click());
  await expect(page).toHaveURL(/\/d\/doc_/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("palette")!.click());
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("one document per window, and vellum:// links open or focus it", async () => {
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("new-draft")!.click());
  await expect(page).toHaveURL(/\/d\/doc_/);
  const id = docId(page.url())!;

  // Opening the library in a new window from the page.
  const second = app.waitForEvent("window");
  await page.evaluate(() => window.vellumDesktop!.openWindow!("/library"));
  const other = await second;
  await other.waitForLoadState("domcontentloaded");
  await expect(other).toHaveURL(/\/library$/);
  expect(app.windows()).toHaveLength(2);

  // The document is already open: a link focuses that window instead of opening another.
  await app.evaluate(
    ({ app: a }, url) => a.emit("open-url", { preventDefault() {} }, url),
    `vellum://d/${id}`,
  );
  await page.waitForTimeout(300);
  expect(app.windows()).toHaveLength(2);
  const focused = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getFocusedWindow()?.webContents.getURL(),
  );
  if (focused) expect(focused).toContain(id);

  // After the second window navigates to the document, the first window's copy is the one that counts;
  // opening a new document by link opens a window for it.
  await other.evaluate(() => {
    history.pushState(null, "", "/insights");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  const third = app.waitForEvent("window");
  await app.evaluate(({ app: a }) =>
    a.emit("open-url", { preventDefault() {} }, "vellum://d/doc_0000000000notreal"),
  );
  await expect(await third).toHaveURL(/\/d\/doc_0000000000notreal$/);
  expect(app.windows()).toHaveLength(3);

  // Links that aren't ours are ignored.
  await app.evaluate(({ app: a }) => a.emit("open-url", { preventDefault() {} }, "vellum://d/../../etc"));
  await page.waitForTimeout(300);
  expect(app.windows()).toHaveLength(3);
});

test("windows come back where you left them", async () => {
  await page.evaluate(() => {
    history.pushState(null, "", "/insights");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  // A size that fits whatever screen the test runs on (CI displays are small), and not the default.
  const set = await app.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getPrimaryDisplay().workArea;
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setBounds({
      x: area.x + 30,
      y: area.y + 20,
      width: Math.min(900, area.width - 60),
      height: Math.min(560, area.height - 40),
    });
    return win.getBounds();
  });
  await page.waitForTimeout(200);
  await app.close();
  await launch();
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds());
  expect(bounds).toEqual(set);
  await expect(page).toHaveURL(/\/insights$/);
});

test("files opened with Vellum go through the import review", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vellum-open-"));
  const file = join(dir, "Opened from Finder.md");
  writeFileSync(file, "# Opened from Finder\n\nHello from the file system.\n");
  try {
    await app.evaluate(({ app: a }, f) => a.emit("open-file", { preventDefault() {} }, f), file);
    const dialog = page.getByRole("dialog", { name: "Import files" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Opened from Finder");
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(
      page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Opened from Finder" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Opened from Finder");
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("update settings: channel and opt-out, and administrators can turn updates off", async () => {
  await page.evaluate(() => {
    history.pushState(null, "", "/settings/updates");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("heading", { name: "App updates" })).toBeVisible();
  const auto = page.getByRole("checkbox", { name: /Update automatically/ });
  await expect(auto).toBeChecked();
  await page.getByRole("radio", { name: "Beta" }).click();
  await expect(page.getByRole("radio", { name: "Beta" })).toHaveAttribute("aria-checked", "true");
  await auto.click();
  await expect(auto).not.toBeChecked();
  // A development build never updates itself, and says so.
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByTestId("update-status")).toHaveText(/Development builds/);

  await app.close();
  await launch();
  expect(await page.evaluate(() => window.vellumDesktop!.updates!.getSettings())).toEqual({
    autoUpdate: false,
    channel: "beta",
    managed: false,
  });

  await app.close();
  await launch({ VELLUM_DISABLE_UPDATES: "1" });
  await page.evaluate(() => {
    history.pushState(null, "", "/settings/updates");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("updates-managed")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Update automatically/ })).toHaveCount(0);
  const refused = await page.evaluate(() => window.vellumDesktop!.updates!.setSettings({ autoUpdate: true }));
  expect(refused.managed).toBe(true);
  expect(refused.autoUpdate).toBe(false);
});
