import { CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import { recordVersion } from "../data/versions.js";
import { docToMarkdown } from "@vellum/editor";
import { useApp } from "../state/app.js";
import { useComments } from "../state/comments.js";
import { useDocSession } from "../state/session.js";
import { acceptWithHistory, canEdit, useSuggestions } from "../state/suggestions.js";
import { create } from "zustand";
import { ThreadCard } from "./Comments.js";
import { SuggestionCard } from "./SuggestionsList.js";

export const useReview = create<{
  open: boolean;
  tab: "open" | "suggestions" | "resolved";
  setOpen(o: boolean): void;
  setTab(t: "open" | "suggestions" | "resolved"): void;
}>((set) => ({
  open: false,
  tab: "open",
  setOpen: (open) => set({ open }),
  setTab: (tab) => set({ tab }),
}));

export function ReviewPanel() {
  const { tab, setTab, setOpen } = useReview();
  const { threads, positions } = useComments();
  const suggestions = useSuggestions((s) => s.items);
  const role = useSuggestions((s) => s.role);
  const { editor, docId } = useDocSession();
  const doc = useApp((s) => s.documents.find((d) => d.id === docId));
  const updateDocument = useApp((s) => s.updateDocument);
  const user = useApp((s) => s.user);
  const [confirming, setConfirming] = useState(false);

  const detached = (id: string) => positions[id] === null;
  const open = threads.filter((t) => t.status === "open");
  const resolved = threads.filter((t) => t.status === "resolved");
  const quote = (id: string, fallback: string) => {
    const p = positions[id];
    if (!p || !editor || p.to > editor.state.doc.content.size) return fallback;
    return editor.state.doc.textBetween(p.from, p.to, " ", " ");
  };
  const outstanding = open.length + suggestions.length;
  const approved = doc?.status === "approved";

  async function approve() {
    if (!doc || !editor || !user) return;
    await updateDocument(doc.id, { status: "approved", updatedAt: new Date().toISOString() });
    await recordVersion(
      doc.id,
      docToMarkdown(editor.state.doc),
      { kind: "user", userId: user.id },
      "named",
      "Approved",
    );
    setConfirming(false);
  }

  return (
    <aside className="vl-rail vl-review" aria-label="Review">
      <header className="vl-assistant-head">
        <h2>Review</h2>
        <span className="vl-toolbar-spacer" />
        <button className="vl-icon-btn" aria-label="Close review" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </header>

      <div className="vl-review-approve">
        {approved ? (
          <p className="vl-ok">
            <CheckCircle2 size={16} /> Draft approved
          </p>
        ) : confirming ? (
          <div className="vl-notice" role="alert">
            <span>
              {outstanding > 0
                ? `${open.length} open comment${open.length === 1 ? "" : "s"} and ${suggestions.length} pending suggestion${suggestions.length === 1 ? "" : "s"}. Approve anyway?`
                : "Approve this draft? It will be marked Approved and saved as a named version."}
            </span>
            <button className="vl-btn vl-btn-primary" onClick={() => void approve()}>
              Approve
            </button>
            <button className="vl-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="vl-btn vl-btn-primary"
            disabled={!canEdit(role)}
            onClick={() => setConfirming(true)}
          >
            <CheckCircle2 size={14} /> Approve draft
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Review items" className="vl-tabs vl-review-tabs">
        {(
          [
            ["open", `Open (${open.length})`],
            ["suggestions", `Suggestions (${suggestions.length})`],
            ["resolved", `Resolved (${resolved.length})`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="vl-review-body" role="tabpanel">
        {tab === "open" &&
          (open.length === 0 ? (
            <p className="vl-muted">No open comments.</p>
          ) : (
            <div className="vl-threads">
              {open.map((t) => (
                <ThreadCard
                  key={t.id}
                  thread={t}
                  quote={detached(t.id) ? t.anchor.quote : quote(t.id, t.anchor.quote)}
                />
              ))}
            </div>
          ))}
        {tab === "suggestions" &&
          (suggestions.length === 0 ? (
            <p className="vl-muted">No pending suggestions.</p>
          ) : (
            <>
              {canEdit(role) && editor && (
                <div className="vl-actions vl-bulk-sug">
                  <button className="vl-btn" onClick={() => acceptWithHistory(editor, suggestions)}>
                    Accept all
                  </button>
                  <button
                    className="vl-btn"
                    onClick={() => editor.commands.rejectSuggestions(suggestions.map((s) => s.id))}
                  >
                    Dismiss all
                  </button>
                </div>
              )}
              <div className="vl-threads">
                {suggestions.map((s) => (
                  <SuggestionCard key={s.id} s={s} />
                ))}
              </div>
            </>
          ))}
        {tab === "resolved" &&
          (resolved.length === 0 ? (
            <p className="vl-muted">Nothing resolved yet.</p>
          ) : (
            <div className="vl-threads">
              {resolved.map((t) => (
                <ThreadCard key={t.id} thread={t} quote={quote(t.id, t.anchor.quote)} />
              ))}
            </div>
          ))}
      </div>
    </aside>
  );
}
