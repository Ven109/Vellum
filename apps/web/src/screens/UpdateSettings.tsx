import { useEffect, useState } from "react";
import { SettingsLayout } from "../components/SettingsLayout.js";
import type { DesktopUpdateSettings, DesktopUpdateStatus } from "../data/keys.js";

const STATUS: Record<DesktopUpdateStatus["state"], string> = {
  idle: "",
  checking: "Checking for updates…",
  available: "An update is available and downloading.",
  downloading: "Downloading the update…",
  ready: "The update is ready. Restart Vellum to use it.",
  none: "You’re on the latest version.",
  error: "Couldn’t check for updates.",
  disabled: "Updates are turned off.",
};

/** Desktop app updates: automatic or not, and which release channel. */
export function UpdateSettingsPage() {
  const updates = window.vellumDesktop?.updates;
  const [settings, setSettings] = useState<DesktopUpdateSettings | null>(null);
  const [status, setStatus] = useState<DesktopUpdateStatus>({ state: "idle" });

  useEffect(() => {
    if (!updates) return;
    void updates.getSettings().then(setSettings);
    return updates.onStatus(setStatus);
  }, [updates]);

  if (!updates) {
    return (
      <SettingsLayout title="App updates">
        <p className="vl-lede">Updates apply to the desktop app. The web app is always up to date.</p>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout title="App updates">
      <section className="vl-card" aria-labelledby="updates-h">
        <h2 id="updates-h">Updates</h2>
        {settings?.managed ? (
          <p className="vl-muted" data-testid="updates-managed">
            Your administrator has turned off automatic updates for this installation.
          </p>
        ) : (
          settings && (
            <>
              <label className="vl-switch">
                <input
                  type="checkbox"
                  checked={settings.autoUpdate}
                  onChange={(e) =>
                    void updates.setSettings({ autoUpdate: e.target.checked }).then(setSettings)
                  }
                />
                <span>
                  Update automatically
                  <small className="vl-muted">
                    Downloads new versions in the background and installs them on restart.
                  </small>
                </span>
              </label>
              <fieldset className="vl-choice">
                <legend>Channel</legend>
                <div className="vl-segmented" role="radiogroup" aria-label="Release channel">
                  {(["latest", "beta"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={settings.channel === c}
                      onClick={() => void updates.setSettings({ channel: c }).then(setSettings)}
                    >
                      {c === "latest" ? "Stable" : "Beta"}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )
        )}
        <div className="vl-actions">
          <button
            className="vl-btn"
            disabled={settings?.managed || status.state === "checking"}
            onClick={() => void updates.check()}
          >
            Check for updates
          </button>
          {status.state === "ready" && (
            <button className="vl-btn vl-btn-primary" onClick={() => void updates.install()}>
              Restart to update
            </button>
          )}
          <span className="vl-muted" role="status" data-testid="update-status">
            {status.message ?? STATUS[status.state]}
            {status.version && status.state !== "none" ? ` (${status.version})` : ""}
          </span>
        </div>
      </section>
    </SettingsLayout>
  );
}
