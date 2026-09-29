import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { app, BrowserWindow, ipcMain, protocol, safeStorage, session } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { isImportable, sendCommand, sendFilesToImport } from "./commands.js";
import { deepLinkFromArgv, parseDeepLink } from "./deeplinks.js";
import { buildMenu, buildQuickAccess, registerGlobalShortcut } from "./menu.js";
import { flushSettings } from "./settings.js";
import {
  changeUpdateSettings,
  checkForUpdates,
  currentStatus,
  installUpdate,
  startUpdates,
  updateSettingsView,
} from "./updates.js";
import {
  activeWindow,
  hardenContents,
  openPath,
  ORIGIN,
  rememberWindowsForQuit,
  restoreWindows,
  setWindowPath,
} from "./windows.js";

/**
 * Vellum desktop: the web app served from a private `app://vellum` origin inside a locked-down
 * BrowserWindow (context isolation, sandbox, no Node in the page). The only bridge to the system is the
 * preload script's small, validated IPC surface.
 */

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

const validPath = (p: unknown): p is string =>
  typeof p === "string" && p.length < 500 && /^\/[\w\-/.~%?=&#]*$/.test(p) && !p.startsWith("//");

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

  // Windows: one document per window.
  ipcMain.handle("window:open", (e, path: unknown) => {
    if (!fromApp(e) || !validPath(path)) throw new Error("rejected");
    openPath(path);
  });
  ipcMain.on("window:path", (e, path: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && fromApp(e as unknown as IpcMainInvokeEvent) && validPath(path)) setWindowPath(win.id, path);
  });

  // Updates.
  ipcMain.handle("updates:settings", (e) => {
    if (!fromApp(e)) throw new Error("rejected");
    return updateSettingsView();
  });
  ipcMain.handle("updates:set", (e, patch: unknown) => {
    if (!fromApp(e) || typeof patch !== "object" || !patch) throw new Error("rejected");
    return changeUpdateSettings(patch as Record<string, unknown>);
  });
  ipcMain.handle("updates:check", async (e) => {
    if (!fromApp(e)) throw new Error("rejected");
    await checkForUpdates();
  });
  ipcMain.handle("updates:install", (e) => {
    if (!fromApp(e)) throw new Error("rejected");
    installUpdate();
  });
  ipcMain.handle("updates:status", (e) => (fromApp(e) ? currentStatus() : null));
}

// --- Links and files from the system ------------------------------------------------------------------

let ready = false;
const pendingLinks: string[] = [];
const pendingFiles: string[] = [];

function handleDeepLink(url: string) {
  if (!ready) return void pendingLinks.push(url);
  const link = parseDeepLink(url);
  if (!link) return;
  if (link.type === "new-draft") sendCommand(activeWindow(), { type: "new-draft" });
  else openPath(link.path);
}

function handleFiles(files: string[]) {
  const importable = files.filter(isImportable);
  if (!importable.length) return;
  if (!ready) return void pendingFiles.push(...importable);
  void sendFilesToImport(activeWindow(), importable);
}

const filesFromArgv = (argv: string[]) => argv.slice(1).filter((a) => !a.startsWith("-") && isImportable(a));

// vellum:// links. In development the executable needs the app path to be registered.
if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient("vellum", process.execPath, [process.argv[1]]);
} else if (!process.env.VELLUM_NO_PROTOCOL) {
  app.setAsDefaultProtocolClient("vellum");
}

// One Vellum at a time: a second launch (a link, "Open with…") hands its request to the running app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = deepLinkFromArgv(argv);
    const files = filesFromArgv(argv);
    if (link) handleDeepLink(link);
    else if (files.length) handleFiles(files);
    else activeWindow();
  });
  // macOS delivers links and opened files as events, possibly before the app is ready.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
  app.on("open-file", (event, file) => {
    event.preventDefault();
    handleFiles([file]);
  });

  app.enableSandbox();

  void app.whenReady().then(() => {
    // Deny every permission request (camera, notifications, geolocation…) unless we add it on purpose.
    // Every permission is denied except the microphone for our own page (voice sessions): audio only,
    // never the camera or screen.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      const fromUs = (details.requestingUrl ?? "").startsWith(`${ORIGIN}/`);
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      callback(fromUs && permission === "media" && types.length > 0 && types.every((t) => t === "audio"));
    });
    session.defaultSession.setPermissionCheckHandler(
      (_wc, permission, origin) => permission === "media" && origin.startsWith(ORIGIN),
    );
    serveApp();
    registerIpc();
    buildMenu();
    const link = deepLinkFromArgv(process.argv);
    const launchLink = link ? parseDeepLink(link) : null;
    if (launchLink?.type === "open") openPath(launchLink.path);
    else restoreWindows();
    if (launchLink?.type === "new-draft") pendingLinks.push(link!);
    pendingFiles.push(...filesFromArgv(process.argv));
    ready = true;
    for (const l of pendingLinks.splice(0)) handleDeepLink(l);
    if (pendingFiles.length) handleFiles(pendingFiles.splice(0));
    buildQuickAccess();
    registerGlobalShortcut();
    startUpdates();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) restoreWindows();
    });
  });
}

app.on("before-quit", () => {
  rememberWindowsForQuit();
  flushSettings();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_e, contents) => hardenContents(contents));
