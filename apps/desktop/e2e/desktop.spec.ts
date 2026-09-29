import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

  // Web links go to the default browser. Record instead of really opening one: a browser started by the
  // test would outlive the app and hold its output open.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = async (url: string) => void opened.push(url);
  });
  await page.evaluate(() => {
    window.location.href = "https://example.com/";
  });
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/^app:\/\/vellum\//);
  expect(await app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual([
    "https://example.com/",
  ]);

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

test("connects to a Vellum server with a token and syncs drafts to it", async () => {
  const { execSync, spawn } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const root = fileURLToPath(new URL("../..", import.meta.url));
  if (!existsSync(join(root, "server/dist/main.js")))
    execSync("pnpm --filter @vellum/server build", { cwd: root, stdio: "ignore" });
  const port = await new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
  const dataDir = mkdtempSync(join(tmpdir(), "vellum-server-"));
  const server = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(root, "server/dist/main.js")],
    {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        VELLUM_DATA_DIR: dataDir,
        LOG_LEVEL: "warn",
      },
      stdio: "ignore",
    },
  );
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(`${base}/api/health`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const setup = await fetch(`${base}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vellum-token": "1" },
      body: JSON.stringify({
        email: "desk@example.com",
        name: "Desk",
        password: "a long desktop password",
        workspaceName: "Team",
      }),
    }).then((r) => r.json() as Promise<{ token: string; workspaces: Array<{ id: string }> }>);

    await page.evaluate(() => {
      history.pushState(null, "", "/settings/account");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.getByLabel("Server address").fill(base);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByLabel("Email").fill("desk@example.com");
    await page.getByLabel("Password").fill("a long desktop password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: /Team/ }),
    ).toBeVisible();

    await page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("button", { name: "New draft" })
      .click();
    await page.getByRole("textbox", { name: "Title" }).fill("Synced from the desktop");
    await page.getByRole("textbox", { name: "Title" }).press("Enter");
    await page.keyboard.type("Hello, server.");
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

    await expect
      .poll(async () => {
        const docs = (await fetch(`${base}/api/workspaces/${setup.workspaces[0]!.id}/documents`, {
          headers: { authorization: `Bearer ${setup.token}` },
        }).then((r) => r.json())) as Array<{ title: string }>;
        return docs.map((d) => d.title);
      })
      .toContain("Synced from the desktop");
  } finally {
    // Wait for the server to exit: Windows keeps its database file locked until then.
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
