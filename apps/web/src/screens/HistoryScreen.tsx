import { getSchema } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { compareVersions, groupByDay } from "@vellum/core";
import type { Version, VersionAuthor } from "@vellum/core";
import { markdownToDoc, vellumExtensions } from "@vellum/editor";
import { ArrowLeft, Bookmark, Copy, RotateCcw } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { account } from "../data/account.js";
import { copyAsNewDraft, restoreVersion } from "../data/history-actions.js";
import { getVersion, listVersions, nameVersion, useVersionEvents } from "../data/versions.js";
import type { VersionSummary } from "../data/versions.js";
import { displayTitle } from "../components/Sidebar.js";
import { useApp } from "../state/app.js";
import { docPath, navigate } from "../state/router.js";

type View = "changes" | "side" | "clean";
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "changes", label: "Changes" },
  { id: "side", label: "Side by side" },
  { id: "clean", label: "Clean" },
];

function usePeople(): Map<string, string> {
  const user = useApp((s) => s.user);
  const members = useApp((s) => s.members);
  const workspace = useApp((s) => s.workspace);
  const signedIn = useApp((s) => !!s.account);
  const [remote, setRemote] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!signedIn || !workspace) return;
    account.members(workspace.id).then(
      (r) => setRemote(r.members),
      () => undefined,
    );
  }, [signedIn, workspace]);
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const p of [...members, ...remote]) m.set(p.id, p.name);
    if (user) m.set(user.id, "You");
    return m;
  }, [members, remote, user]);
}

export function authorLabel(author: VersionAuthor, people: Map<string, string>): string {
  const name = (id: string) =>
    id
      .split(",")
      .map((x) => people.get(x) ?? "Someone")
      .join(", ");
  switch (author.kind) {
    case "user":
      return name(author.userId);
    case "assistant":
      return `Assistant (${author.model}), asked by ${name(author.requestedBy)}`;
    case "suggestion":
      return `Suggestion by ${name(author.suggestedBy)}, accepted by ${name(author.acceptedBy)}`;
    case "system":
      return "Vellum";
  }
}

const REASON: Partial<Record<Version["reason"], string>> = {
  checkpoint: "Checkpoint",
  restore: "Restored",
  assistant: "Assistant edit",
  suggestion: "Suggestion accepted",
  import: "Imported",
  "sync-conflict": "Merged edits",
};

function dayLabel(day: string): string {
  const today = new Date();
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (day === key(today)) return "Today";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (day === key(y)) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Changes({ before, after }: { before: string; after: string }) {
  const { ops } = useMemo(() => compareVersions(before, after), [before, after]);
  return (
    <div className="vl-diff" data-testid="diff-changes">
      {ops.map((op, i) =>
        op.type === "insert" ? (
          <ins key={i}>{op.text}</ins>
        ) : op.type === "delete" ? (
          <del key={i}>{op.text}</del>
        ) : (
          <Fragment key={i}>{op.text}</Fragment>
        ),
      )}
    </div>
  );
}

function SideBySide({ before, after }: { before: string; after: string }) {
  const { ops } = useMemo(() => compareVersions(before, after), [before, after]);
  return (
    <div className="vl-diff-side">
      <section aria-label="Before">
        <h3>Before</h3>
        <div className="vl-diff">
          {ops.map((op, i) =>
            op.type === "insert" ? null : op.type === "delete" ? (
              <del key={i}>{op.text}</del>
            ) : (
              <Fragment key={i}>{op.text}</Fragment>
            ),
          )}
        </div>
      </section>
      <section aria-label="After">
        <h3>After</h3>
        <div className="vl-diff">
          {ops.map((op, i) =>
            op.type === "delete" ? null : op.type === "insert" ? (
              <ins key={i}>{op.text}</ins>
            ) : (
              <Fragment key={i}>{op.text}</Fragment>
            ),
          )}
        </div>
      </section>
    </div>
  );
}

function Clean({ markdown }: { markdown: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const schema = getSchema(vellumExtensions());
    const doc = markdownToDoc(schema, markdown);
    el.replaceChildren(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
  }, [markdown]);
  return <div ref={ref} className="vl-prose vl-clean" data-testid="diff-clean" />;
}

export function HistoryScreen({ docId }: { docId: string }) {
  const meta = useApp(
    (s) => s.documents.find((d) => d.id === docId) ?? s.shared.find((d) => d.docId === docId),
  );
  const title = meta?.title ?? "";
  const changed = useVersionEvents((s) => s.changed[docId] ?? 0);
  const people = usePeople();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("changes");
  const [content, setContent] = useState<{ after: Version; before: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listVersions(docId).then((list) => {
      if (cancelled) return;
      setVersions(list);
      setSelected((s) => (s && list.some((v) => v.id === s) ? s : (list[0]?.id ?? null)));
    });
    return () => {
      cancelled = true;
    };
  }, [docId, changed]);

  useEffect(() => {
    if (!selected || !versions) return;
    let cancelled = false;
    const index = versions.findIndex((v) => v.id === selected);
    const previous = versions[index + 1];
    void Promise.all([
      getVersion(docId, selected),
      previous ? getVersion(docId, previous.id) : undefined,
    ]).then(([after, before]) => {
      if (!cancelled && after) setContent({ after, before: before?.markdown ?? "" });
    });
    return () => {
      cancelled = true;
    };
  }, [docId, selected, versions]);

  const groups = useMemo(() => groupByDay(versions ?? []), [versions]);
  const current = versions?.find((v) => v.id === selected);

  return (
    <main className="vl-main vl-history-main">
      <header className="vl-topbar">
        <button className="vl-btn" onClick={() => navigate(docPath(docId))}>
          <ArrowLeft size={14} /> Back to document
        </button>
        <h1 className="vl-history-title">History · {displayTitle(title)}</h1>
        <div className="vl-segmented" role="radiogroup" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} role="radio" aria-checked={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </header>
      <div className="vl-history">
        <nav className="vl-timeline" aria-label="Versions">
          {versions === null ? (
            <p className="vl-muted">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="vl-muted">
              No versions yet. Vellum saves one every few minutes while you write, and you can save a named
              version from the command palette.
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.day} aria-label={dayLabel(g.day)}>
                <h2 className="vl-rail-heading">{dayLabel(g.day)}</h2>
                <ol>
                  {g.versions.map((v) => (
                    <li key={v.id}>
                      <button
                        className="vl-timeline-item"
                        aria-pressed={v.id === selected}
                        onClick={() => setSelected(v.id)}
                      >
                        <span className="vl-timeline-row">
                          <strong>{time(v.createdAt)}</strong>
                          <span className="vl-diff-counts">
                            <span className="vl-plus">+{v.stats.wordsAdded}</span>{" "}
                            <span className="vl-minus">−{v.stats.wordsRemoved}</span>
                          </span>
                        </span>
                        <span className="vl-timeline-author">{authorLabel(v.author, people)}</span>
                        {(v.name || REASON[v.reason]) && (
                          <span className={v.name ? "vl-version-name" : "vl-muted"}>
                            {v.name ? (
                              <>
                                <Bookmark size={11} /> {v.name}
                              </>
                            ) : (
                              REASON[v.reason]
                            )}
                          </span>
                        )}
                        {v.pending && <span className="vl-muted">Not uploaded yet</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))
          )}
        </nav>
        <section className="vl-version" aria-label="Selected version">
          {current && content && content.after.id === current.id ? (
            <>
              <header className="vl-version-head">
                <div>
                  <h2>
                    {current.name ?? `${dayLabel(groupByDay([current])[0]!.day)}, ${time(current.createdAt)}`}
                  </h2>
                  <p className="vl-muted">
                    {authorLabel(current.author, people)} · {current.stats.wordCount.toLocaleString()} words
                  </p>
                </div>
                <div className="vl-actions">
                  <button
                    className="vl-btn"
                    onClick={() => {
                      const name = window.prompt("Name this version", current.name ?? "")?.trim();
                      if (name !== undefined) void nameVersion(docId, current.id, name);
                    }}
                  >
                    <Bookmark size={14} /> {current.name ? "Rename" : "Name this version"}
                  </button>
                  <button
                    className="vl-btn"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void copyAsNewDraft(content.after)
                        .then((id) => navigate(docPath(id)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Copy size={14} /> Copy as new draft
                  </button>
                  <button
                    className="vl-btn vl-btn-primary"
                    disabled={busy || current.id === versions?.[0]?.id}
                    onClick={() => {
                      setBusy(true);
                      void restoreVersion(docId, content.after)
                        .then(() => navigate(docPath(docId)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <RotateCcw size={14} /> Restore this version
                  </button>
                </div>
              </header>
              {view === "changes" && <Changes before={content.before} after={content.after.markdown} />}
              {view === "side" && <SideBySide before={content.before} after={content.after.markdown} />}
              {view === "clean" && <Clean markdown={content.after.markdown} />}
            </>
          ) : (
            versions && versions.length > 0 && <p className="vl-muted">Loading version…</p>
          )}
        </section>
      </div>
    </main>
  );
}
