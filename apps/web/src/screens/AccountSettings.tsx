import { useEffect, useState } from "react";
import { SettingsLayout } from "../components/SettingsLayout.js";
import { ApiError, account } from "../data/account.js";
import { useApp } from "../state/app.js";
import { useAuth } from "../state/auth.js";

/** Your profile: name (shown to collaborators), email and signing out. */
export function AccountSettingsPage() {
  const user = useApp((s) => s.user);
  const repo = useApp((s) => s.repo);
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.me);
  const signOut = useAuth((s) => s.signOut);
  const [name, setName] = useState(user?.name ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(user?.name ?? ""), [user?.name]);
  const signedIn = status === "signed-in" && !!me;

  async function save() {
    if (!user || !name.trim()) return;
    setError(null);
    try {
      if (signedIn) {
        const next = await account.rename(name.trim());
        useAuth.setState({ me: next });
      }
      const updated = { ...user, name: name.trim() };
      await repo.putUser(updated);
      useApp.setState({ user: updated });
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your name.");
    }
  }

  return (
    <SettingsLayout title="Profile">
      <section className="vl-card" aria-labelledby="profile-h">
        <h2 id="profile-h">Name</h2>
        <form
          className="vl-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            className="vl-input"
            aria-label="Your name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
          <button className="vl-btn" disabled={!name.trim() || name.trim() === user?.name}>
            Save
          </button>
          {saved && (
            <span className="vl-muted" role="status">
              Saved
            </span>
          )}
        </form>
        <p className="vl-muted">Shown on comments, suggestions, cursors and in version history.</p>
        {error && (
          <p className="vl-auth-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="vl-card" aria-labelledby="signin-h">
        <h2 id="signin-h">Sign-in</h2>
        {signedIn ? (
          <>
            <p>
              Signed in as <strong>{me.user.email}</strong>
              {me.user.isAdmin && " · server administrator"}.
            </p>
            <button className="vl-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        ) : (
          <p className="vl-muted">
            You’re using Vellum on this device only. Everything is saved locally; run Vellum with a server to
            sign in and sync between devices.
          </p>
        )}
      </section>
    </SettingsLayout>
  );
}
