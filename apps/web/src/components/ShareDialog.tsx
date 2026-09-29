import { Check, Copy, Globe, Link2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DocumentMeta } from "@vellum/core";
import { ApiError, account } from "../data/account.js";
import type { DocRole, SharingState } from "../data/account.js";
import { useApp } from "../state/app.js";

const ROLES: Array<{ id: DocRole; label: string; hint: string }> = [
  { id: "view", label: "Can view", hint: "Read only" },
  { id: "comment", label: "Can comment", hint: "Read and comment" },
  { id: "suggest", label: "Can suggest", hint: "Edits become suggestions" },
  { id: "edit", label: "Can edit", hint: "Full editing" },
];
const EXPIRY = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

function errorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 404 && e.code === "not_found")
      return "This document hasn't reached the server yet. Wait until it says Saved, then try again.";
    return e.message;
  }
  return "Couldn't reach the server.";
}

function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="vl-btn"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => undefined);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : label}
    </button>
  );
}

function RoleSelect(props: { value: DocRole; onChange(r: DocRole): void; label: string }) {
  return (
    <select
      className="vl-input vl-role-select"
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as DocRole)}
    >
      {ROLES.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

/** Share a document: people and their roles, expiring links, and a public link once published. */
export function ShareDialog({ doc, onClose }: { doc: DocumentMeta; onClose(): void }) {
  const signedIn = useApp((s) => !!s.account);
  const [state, setState] = useState<SharingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DocRole>("comment");
  const [linkRole, setLinkRole] = useState<DocRole>("view");
  const [linkDays, setLinkDays] = useState(7);
  const [newLink, setNewLink] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const docUrl = `${window.location.origin}/d/${doc.id}`;

  useEffect(() => {
    if (!signedIn) return;
    account.sharing(doc.id).then(setState, (e: unknown) => setError(errorText(e)));
  }, [doc.id, signedIn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const run = (p: Promise<SharingState>) =>
    p.then(
      (s) => {
        setState(s);
        setError(null);
      },
      (e: unknown) => setError(errorText(e)),
    );

  return (
    <div className="vl-share" role="dialog" aria-label="Share" ref={ref}>
      <header className="vl-share-head">
        <h2>Share “{doc.title || "Untitled"}”</h2>
        <button className="vl-icon-btn" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      {!signedIn ? (
        <p className="vl-muted">
          This document is only on this device. Run Vellum with a server to share it with other people.
        </p>
      ) : (
        <>
          <form
            className="vl-share-invite"
            onSubmit={(e) => {
              e.preventDefault();
              void run(account.share(doc.id, email, role)).then(() => setEmail(""));
            }}
          >
            <input
              className="vl-input"
              type="email"
              required
              placeholder="Add people by email"
              aria-label="Email to share with"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <RoleSelect value={role} onChange={setRole} label="Role for new person" />
            <button className="vl-btn vl-btn-primary">Share</button>
          </form>
          {error && (
            <p className="vl-auth-error" role="alert">
              {error}
            </p>
          )}

          {state && (
            <>
              <h3 className="vl-subhead">People with access</h3>
              <ul className="vl-members" aria-label="People with access">
                {state.people.map((p) => (
                  <li key={p.id}>
                    <span className="vl-avatar" style={{ background: p.avatarColor }} aria-hidden>
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="vl-member-name">
                      <strong>{p.name}</strong>
                      <small className="vl-muted">
                        {p.email}
                        {p.expiresAt && ` · until ${new Date(p.expiresAt).toLocaleDateString()}`}
                      </small>
                    </span>
                    <RoleSelect
                      value={p.role}
                      label={`Role for ${p.name}`}
                      onChange={(r) => void run(account.setShareRole(doc.id, p.id, r))}
                    />
                    <button
                      className="vl-icon-btn"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => void run(account.unshare(doc.id, p.id))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
                <li className="vl-muted">
                  <span className="vl-member-name">
                    Everyone in the workspace ({state.workspace.members.length}) can edit
                  </span>
                </li>
              </ul>

              <h3 className="vl-subhead">
                <Link2 size={13} /> Share link
              </h3>
              <div className="vl-share-invite">
                <RoleSelect value={linkRole} onChange={setLinkRole} label="Link role" />
                <select
                  className="vl-input"
                  aria-label="Link expires after"
                  value={linkDays}
                  onChange={(e) => setLinkDays(Number(e.target.value))}
                >
                  {EXPIRY.map((x) => (
                    <option key={x.days} value={x.days}>
                      Expires in {x.label}
                    </option>
                  ))}
                </select>
                <button
                  className="vl-btn"
                  onClick={() =>
                    void account.createLink(doc.id, linkRole, linkDays).then(
                      (r) => {
                        setNewLink(r.url);
                        setState(r.state);
                      },
                      (e: unknown) => setError(errorText(e)),
                    )
                  }
                >
                  Create link
                </button>
              </div>
              {newLink && (
                <div className="vl-invite-link">
                  <input className="vl-input" readOnly aria-label="Share link" value={newLink} />
                  <CopyButton text={newLink} />
                </div>
              )}
              {state.links.length > 0 && (
                <ul className="vl-share-links" aria-label="Active links">
                  {state.links.map((l) => (
                    <li key={l.id}>
                      <span>
                        {ROLES.find((r) => r.id === l.role)?.label} · expires{" "}
                        {new Date(l.expiresAt).toLocaleDateString()}
                      </span>
                      <button className="vl-link" onClick={() => void run(account.revokeLink(doc.id, l.id))}>
                        Turn off
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="vl-subhead">
                <Globe size={13} /> Public link
              </h3>
              {doc.status !== "published" && !state.publicUrl ? (
                <p className="vl-muted">Mark this piece Published to get a public, read-only link.</p>
              ) : (
                <>
                  <label className="vl-auth-check">
                    <input
                      type="checkbox"
                      checked={!!state.publicUrl}
                      onChange={(e) => void run(account.setPublic(doc.id, e.target.checked))}
                    />
                    Anyone with the link can read this piece
                  </label>
                  {state.publicUrl && (
                    <div className="vl-invite-link">
                      <input className="vl-input" readOnly aria-label="Public link" value={state.publicUrl} />
                      <CopyButton text={state.publicUrl} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      <footer className="vl-share-foot">
        <CopyButton text={docUrl} label="Copy document link" />
      </footer>
    </div>
  );
}
