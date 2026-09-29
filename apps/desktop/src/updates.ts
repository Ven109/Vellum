import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { settings, updateSettings } from "./settings.js";

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "none" | "error" | "disabled";
  version?: string;
  message?: string;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;
let status: UpdateStatus = { state: "idle" };
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Administrators can turn updates off for an installation: VELLUM_DISABLE_UPDATES=1, or an
 * update-policy.json of {"disabled": true} next to the app's resources (for managed deployments).
 */
export function updatesManaged(): boolean {
  if (/^(1|true|yes)$/i.test(process.env.VELLUM_DISABLE_UPDATES ?? "")) return true;
  const policy = join(process.resourcesPath ?? "", "update-policy.json");
  try {
    return (
      existsSync(policy) &&
      (JSON.parse(readFileSync(policy, "utf8")) as { disabled?: boolean }).disabled === true
    );
  } catch {
    return false;
  }
}

export function updateSettingsView() {
  const s = settings();
  return { autoUpdate: s.autoUpdate, channel: s.channel, managed: updatesManaged() };
}

function setStatus(next: UpdateStatus) {
  status = next;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("updates:status", status);
}

export const currentStatus = () => status;

/** Updates only make sense for a packaged, signed build (dev builds have no update feed). */
function canUpdate() {
  return app.isPackaged && !updatesManaged();
}

function configure() {
  const s = settings();
  autoUpdater.autoDownload = s.autoUpdate;
  autoUpdater.autoInstallOnAppQuit = s.autoUpdate;
  autoUpdater.allowPrerelease = s.channel === "beta";
  autoUpdater.channel = s.channel;
  autoUpdater.allowDowngrade = false;
}

export async function checkForUpdates(): Promise<void> {
  if (updatesManaged())
    return setStatus({ state: "disabled", message: "Updates are managed by your administrator." });
  if (!app.isPackaged) return setStatus({ state: "none", message: "Development builds don’t update." });
  configure();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setStatus({ state: "error", message: `Couldn’t check for updates: ${(err as Error).message}` });
  }
}

export function installUpdate() {
  if (status.state === "ready") autoUpdater.quitAndInstall();
}

export function changeUpdateSettings(patch: { autoUpdate?: unknown; channel?: unknown }) {
  if (updatesManaged()) return updateSettingsView();
  const next: { autoUpdate?: boolean; channel?: "latest" | "beta" } = {};
  if (typeof patch.autoUpdate === "boolean") next.autoUpdate = patch.autoUpdate;
  if (patch.channel === "latest" || patch.channel === "beta") next.channel = patch.channel;
  updateSettings(next, true);
  schedule();
  return updateSettingsView();
}

function schedule() {
  clearInterval(timer);
  timer = undefined;
  if (!canUpdate() || !settings().autoUpdate) return;
  timer = setInterval(() => void checkForUpdates(), SIX_HOURS);
}

export function startUpdates() {
  autoUpdater.logger = null;
  autoUpdater.on("checking-for-update", () => setStatus({ state: "checking" }));
  autoUpdater.on("update-available", (i) =>
    setStatus({ state: settings().autoUpdate ? "downloading" : "available", version: i.version }),
  );
  autoUpdater.on("update-not-available", () => setStatus({ state: "none" }));
  autoUpdater.on("update-downloaded", (i) => setStatus({ state: "ready", version: i.version }));
  autoUpdater.on("error", (err) => setStatus({ state: "error", message: `Update failed: ${err.message}` }));
  if (updatesManaged()) status = { state: "disabled" };
  schedule();
  // Check shortly after launch, once the window is up, so startup isn't slowed down.
  if (canUpdate() && settings().autoUpdate) setTimeout(() => void checkForUpdates(), 15_000);
}
