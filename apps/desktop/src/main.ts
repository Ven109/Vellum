import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { app, BrowserWindow, ipcMain, protocol, safeStorage, session, shell } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";

/**
 * Vellum desktop: the web app served from a private `app://vellum` origin inside a locked-down
 * BrowserWindow (context isolation, sandbox, no Node in the page). The only bridge to the system is the
 * preload script's small, validated IPC surface.
 */
const ORIGIN = "app://vellum";
const startedAt = Date.now();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** Where the built web app lives: bundled into resources when packaged, or the workspace build in dev. */
function webRoot(): string {
  const packaged = join(process.resourcesPath, "web");
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return join(app.getAppPath(), "..", "web", "dist");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

// The page may talk to its own origin and to the AI providers and Vellum servers the writer chooses.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

function serveApp() {
  const root = webRoot();
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "vellum") return new Response("Not found", { status: 404 });
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    let file = join(root, path);
    // Never serve anything outside the web build; unknown paths are app routes (single-page app).
    if (!file.startsWith(root + sep) || !extname(path) || !existsSync(file)) {
      path = "index.html";
      file = join(root, path);
    }
    const body = await readFile(file);
    return new Response(body, {
      headers: {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "content-security-policy": CSP,
        "x-content-type-options": "nosniff",
      },
    });
  });
}

// --- Secrets: provider API keys, encrypted with the OS keychain (safeStorage) ------------------------

const secretsFile = () => join(app.getPath("userData"), "secrets.json");
let secrets: Record<string, string> | null = null;

async function loadSecrets(): Promise<Record<string, string>> {
  if (secrets) return secrets;
  try {
    secrets = JSON.parse(await readFile(secretsFile(), "utf8")) as Record<string, string>;
  } catch {
    secrets = {};
  }
  return secrets;
}

async function saveSecrets() {
  await mkdir(dirname(secretsFile()), { recursive: true });
  await writeFile(secretsFile(), JSON.stringify(secrets ?? {}), { mode: 0o600 });
}

/**
 * A real OS keychain is available. On Linux without a keyring (libsecret/kwallet) Electron falls back to
 * a hard-coded key ("basic_text"), which isn't protection — the page then uses its own encrypted store.
 */
function keychainAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

/** Only our own page may use the bridge. */
function fromApp(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url === ORIGIN || url.startsWith(`${ORIGIN}/`);
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[\w:.-]{1,200}$/.test(id);

function registerIpc() {
  ipcMain.handle("secrets:available", (e) => fromApp(e) && keychainAvailable());
  ipcMain.handle("secrets:set", async (e, id: unknown, value: unknown) => {
    if (!fromApp(e) || !validId(id) || typeof value !== "string" || value.length > 20_000)
      throw new Error("rejected");
    if (!keychainAvailable()) throw new Error("The system keychain isn't available.");
    const all = await loadSecrets();
    all[id] = safeStorage.encryptString(value).toString("base64");
    await saveSecrets();
  });
  ipcMain.handle("secrets:get", async (e, id: unknown) => {
    if (!fromApp(e) || !validId(id)) throw new Error("rejected");
    const stored = (await loadSecrets())[id];
    return stored ? safeStorage.decryptString(Buffer.from(stored, "base64")) : null;
  });
  ipcMain.handle("secrets:delete", async (e, id: unknown) => {
    if (!fromApp(e) || !validId(id)) throw new Error("rejected");
    const all = await loadSecrets();
    delete all[id];
    await saveSecrets();
  });
}

// --- Windows -----------------------------------------------------------------------------------------

const hardened = new WeakSet<WebContents>();

function harden(contents: WebContents) {
  // Windows are hardened when created and again by web-contents-created; attach the handlers once.
  if (hardened.has(contents)) return;
  hardened.add(contents);
  // Stay on our own origin; links to the web open in the default browser.
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

export function createWindow(path = "/"): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Vellum",
    backgroundColor: "#fdfbf7",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  harden(win.webContents);
  win.once("ready-to-show", () => win.show());
  if (process.env.VELLUM_MEASURE_STARTUP) {
    win.webContents.once("did-finish-load", () => {
      // Printed for scripts/budget.mjs, then quit.
      console.log(`VELLUM_STARTUP_MS=${Date.now() - startedAt}`);
      app.quit();
    });
  }
  void win.loadURL(`${ORIGIN}${path}`);
  return win;
}

app.enableSandbox();

void app.whenReady().then(() => {
  // Deny every permission request (camera, notifications, geolocation…) unless we add it on purpose.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  serveApp();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_e, contents) => harden(contents));
