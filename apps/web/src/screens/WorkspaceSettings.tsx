import { SettingsLayout } from "../components/SettingsLayout.js";
import { Check, Copy, UserMinus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, account } from "../data/account.js";
import type { Member, PendingInvite, WorkspaceRole } from "../data/account.js";
import { useApp } from "../state/app.js";
import { useAuth } from "../state/auth.js";
import { ImportCard } from "./ImportCard.js";
import { loadRetention, setRetention } from "../data/versions.js";

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "guest"];
const ROLE_NAMES: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : "Couldn't reach the server.";
}

export function InviteForm({ workspaceId, onInvited }: { workspaceId: string; onInvited(): void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [result, setResult] = useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <form
        className="vl-invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          account.invite(workspaceId, email, role).then(
            (r) => {
              setResult({ ...r, email });
              setCopied(false);
              setEmail("");
              onInvited();
            },
            (err: unknown) => setError(errorText(err)),
          );
        }}
      >
        <input
          className="vl-input"
          type="email"
          required
          aria-label="Email to invite"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className="vl-input"
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as WorkspaceRole)}
        >
          {ROLES.filter((r) => r !== "owner").map((r) => (
            <option key={r} value={r}>
              {ROLE_NAMES[r]}
            </option>
          ))}
        </select>
        <button className="vl-btn vl-btn-primary">Invite</button>
      </form>
      {error && (
        <p className="vl-auth-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="vl-invite-result" role="status">
          <p>
            {result.emailed
              ? `We emailed an invite to ${result.email}. You can also share this link:`
              : `Share this link with ${result.email}. It works once and expires in 7 days.`}
          </p>
          <div className="vl-invite-link">
            <input className="vl-input" readOnly aria-label="Invite link" value={result.link} />
            <button
              className="vl-btn"
              onClick={() => {
                void navigator.clipboard?.writeText(result.link).then(() => setCopied(true));
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function People({ workspaceId, myRole }: { workspaceId: string; myRole: WorkspaceRole }) {
  const me = useAuth((s) => s.me);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canManage = myRole === "owner" || myRole === "admin";

  const load = useCallback(() => {
    account.members(workspaceId).then(
      (r) => {
        setMembers(r.members);
        setInvites(r.invites);
        useApp.setState({
          members: r.members.filter((m) => m.id !== me?.user.id).map((m) => ({ id: m.id, name: m.name })),
        });
      },
      (e: unknown) => setError(errorText(e)),
    );
  }, [workspaceId, me?.user.id]);
  useEffect(load, [load]);

  const act = (p: Promise<unknown>) =>
    p.then(
      () => {
        setError(null);
        load();
      },
      (e: unknown) => setError(errorText(e)),
    );

  return (
    <section className="vl-card" aria-labelledby="people-h">
      <h2 id="people-h">People</h2>
      {canManage && <InviteForm workspaceId={workspaceId} onInvited={load} />}
      {error && (
        <p className="vl-auth-error" role="alert">
          {error}
        </p>
      )}
      <ul className="vl-members" aria-label="Members">
        {members.map((m) => (
          <li key={m.id}>
            <span className="vl-avatar" style={{ background: m.avatarColor }} aria-hidden>
              {m.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="vl-member-name">
              <strong>
                {m.name}
                {m.id === me?.user.id && " (you)"}
              </strong>
              <small className="vl-muted">{m.email}</small>
            </span>
            {myRole === "owner" ? (
              <select
                className="vl-input"
                aria-label={`Role for ${m.name}`}
                value={m.role}
                onChange={(e) =>
                  void act(account.setRole(workspaceId, m.id, e.target.value as WorkspaceRole))
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="vl-muted">{ROLE_NAMES[m.role]}</span>
            )}
            {canManage && m.id !== me?.user.id && m.role !== "owner" && (
              <button
                className="vl-icon-btn"
                aria-label={`Remove ${m.name}`}
                onClick={() => void act(account.removeMember(workspaceId, m.id))}
              >
                <UserMinus size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {invites.length > 0 && (
        <>
          <h3 className="vl-subhead">Invited</h3>
          <ul className="vl-members" aria-label="Pending invites">
            {invites.map((i) => (
              <li key={i.email + i.createdAt}>
                <span className="vl-member-name">
                  <strong>{i.email}</strong>
                  <small className="vl-muted">Invited as {ROLE_NAMES[i.role].toLowerCase()}</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function WorkspaceCard({ workspaceId, myRole }: { workspaceId: string; myRole: WorkspaceRole }) {
  const workspace = useApp((s) => s.workspace);
  const reload = useAuth((s) => s.reload);
  const [name, setName] = useState(workspace?.name ?? "");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(workspace?.name ?? ""), [workspace?.name]);
  const canRename = myRole === "owner" || myRole === "admin";

  return (
    <section className="vl-card" aria-labelledby="ws-h">
      <h2 id="ws-h">Workspace</h2>
      <form
        className="vl-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          account.renameWorkspace(workspaceId, name).then(
            () => reload(),
            (err: unknown) => setError(errorText(err)),
          );
        }}
      >
        <input
          className="vl-input"
          aria-label="Workspace name"
          value={name}
          disabled={!canRename}
          onChange={(e) => setName(e.target.value)}
        />
        {canRename && (
          <button className="vl-btn" disabled={!name.trim() || name === workspace?.name}>
            Rename
          </button>
        )}
      </form>
      <form
        className="vl-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          account
            .createWorkspace(newName)
            .then(async (w) => {
              setNewName("");
              await reload();
              await useApp.getState().switchWorkspace(w.id);
            })
            .catch((err: unknown) => setError(errorText(err)));
        }}
      >
        <input
          className="vl-input"
          aria-label="New workspace name"
          placeholder="New workspace name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="vl-btn" disabled={!newName.trim()}>
          Create workspace
        </button>
      </form>
      {error && (
        <p className="vl-auth-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function AdminCard() {
  const [signups, setSignups] = useState<boolean | null>(null);
  useEffect(() => {
    account.adminSettings().then(
      (s) => setSignups(s.signupsEnabled),
      () => setSignups(null),
    );
  }, []);
  if (signups === null) return null;
  return (
    <section className="vl-card" aria-labelledby="admin-h">
      <h2 id="admin-h">Server</h2>
      <label className="vl-auth-check">
        <input
          type="checkbox"
          checked={signups}
          onChange={(e) =>
            void account.setAdminSettings({ signupsEnabled: e.target.checked }).then((s) => {
              setSignups(s.signupsEnabled);
              useAuth.setState((a) => ({
                instance: a.instance ? { ...a.instance, signupsEnabled: s.signupsEnabled } : null,
              }));
            })
          }
        />
        Let anyone with the address create an account
      </label>
      <p className="vl-muted vl-small-text">When off, people can only join with an invite.</p>
    </section>
  );
}

function HistoryCard() {
  const workspace = useApp((s) => s.workspace);
  const me = useAuth((s) => s.me);
  const policy = workspace?.settings.retention;
  const [keepAll, setKeepAll] = useState(String(policy?.keepAllForDays ?? 7));
  const [keepDaily, setKeepDaily] = useState(String(policy?.keepDailyForDays ?? 90));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = me?.workspaces.find((w) => w.id === workspace?.id)?.role;
  const canChange = !role || role === "owner" || role === "admin";

  useEffect(() => {
    void loadRetention();
  }, [workspace?.id]);
  useEffect(() => {
    setKeepAll(String(policy?.keepAllForDays ?? 7));
    setKeepDaily(String(policy?.keepDailyForDays ?? 90));
  }, [policy?.keepAllForDays, policy?.keepDailyForDays]);

  return (
    <section className="vl-card" aria-labelledby="history-h">
      <h2 id="history-h">Version history</h2>
      <p className="vl-muted">
        Vellum saves a version every few minutes while you write and at moments that matter. Older versions
        are thinned out; versions you name are always kept.
      </p>
      <form
        className="vl-retention"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          setError(null);
          setRetention({
            keepAllForDays: Number(keepAll),
            keepDailyForDays: Number(keepDaily),
            keepNamed: true,
          }).then(
            () => setSaved(true),
            (err: unknown) => setError(errorText(err)),
          );
        }}
      >
        <label>
          Keep every version for
          <input
            className="vl-input"
            type="number"
            min={1}
            max={3650}
            required
            disabled={!canChange}
            value={keepAll}
            onChange={(e) => setKeepAll(e.target.value)}
          />
          days
        </label>
        <label>
          then one a day for
          <input
            className="vl-input"
            type="number"
            min={0}
            max={3650}
            required
            disabled={!canChange}
            value={keepDaily}
            onChange={(e) => setKeepDaily(e.target.value)}
          />
          more days
        </label>
        {canChange && <button className="vl-btn">Save</button>}
        {saved && (
          <span className="vl-muted" role="status">
            Saved
          </span>
        )}
      </form>
      {error && (
        <p className="vl-auth-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function WorkspaceSettingsPage() {
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.me);
  const signOut = useAuth((s) => s.signOut);
  const workspace = useApp((s) => s.workspace);
  const onServer = me?.workspaces.find((w) => w.id === workspace?.id);

  return (
    <SettingsLayout title="Workspace and people">
      {status !== "signed-in" || !me ? (
        <p className="vl-lede">
          This workspace lives only on this device. Run Vellum with a server to sign in, sync between devices
          and invite people.
        </p>
      ) : (
        <>
          <p className="vl-lede">
            Signed in as <strong>{me.user.name}</strong> ({me.user.email}).{" "}
            <button className="vl-link vl-inline-link" onClick={() => void signOut()}>
              Sign out
            </button>
          </p>
          {onServer ? (
            <>
              <WorkspaceCard workspaceId={onServer.id} myRole={onServer.role} />
              <People workspaceId={onServer.id} myRole={onServer.role} />
            </>
          ) : (
            <p className="vl-lede">
              “{workspace?.name}” is a local workspace on this device, so it isn’t shared. Switch to a server
              workspace to invite people.
            </p>
          )}
          {me.user.isAdmin && <AdminCard />}
        </>
      )}
      <HistoryCard />
      <ImportCard />
    </SettingsLayout>
  );
}
