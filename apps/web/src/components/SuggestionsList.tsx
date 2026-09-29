import { relativeTime } from "@vellum/core";
import type { SuggestionInfo } from "@vellum/editor";
import { Check, X } from "lucide-react";
import { useDocSession } from "../state/session.js";
import { acceptWithHistory, canEdit, useSuggestions } from "../state/suggestions.js";

function preview(s: SuggestionInfo) {
  return (
    <span className="vl-sug-preview">
      {s.deleted && <del className="vl-sug-del">{s.deleted}</del>}
      {s.deleted && s.inserted && <span aria-hidden> → </span>}
      {s.inserted && <ins className="vl-sug-ins">{s.inserted}</ins>}
    </span>
  );
}

export function SuggestionCard({ s }: { s: SuggestionInfo }) {
  const editor = useDocSession((st) => st.editor);
  const role = useSuggestions((st) => st.role);
  const label = s.kind === "insert" ? "Add" : s.kind === "delete" ? "Delete" : "Replace";
  return (
    <article
      className="vl-sug-card"
      aria-label={`${label} suggestion by ${s.authorName}`}
      onClick={() => editor?.commands.setTextSelection(s.from)}
    >
      <div className="vl-comment-head">
        <strong>{s.authorName || "Someone"}</strong>
        <span className="vl-muted">
          {label} · {s.createdAt ? relativeTime(s.createdAt) : ""}
        </span>
      </div>
      <p>{preview(s)}</p>
      {canEdit(role) && editor && (
        <div className="vl-actions" onClick={(e) => e.stopPropagation()}>
          <button className="vl-btn" onClick={() => acceptWithHistory(editor, [s])}>
            <Check size={13} /> Accept
          </button>
          <button className="vl-btn" onClick={() => editor.commands.rejectSuggestions([s.id])}>
            <X size={13} /> Dismiss
          </button>
        </div>
      )}
    </article>
  );
}

export function SuggestionsList() {
  const items = useSuggestions((s) => s.items);
  const role = useSuggestions((s) => s.role);
  const editor = useDocSession((s) => s.editor);
  return (
    <section aria-label="Suggestions">
      <h2 className="vl-rail-heading">
        Suggestions {items.length > 0 && <span className="vl-count">{items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="vl-muted">No pending suggestions.</p>
      ) : (
        <>
          {canEdit(role) && editor && (
            <div className="vl-actions vl-bulk-sug">
              <button className="vl-btn" onClick={() => acceptWithHistory(editor, items)}>
                Accept all
              </button>
              <button
                className="vl-btn"
                onClick={() => editor.commands.rejectSuggestions(items.map((s) => s.id))}
              >
                Dismiss all
              </button>
            </div>
          )}
          <div className="vl-threads">
            {items.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function ModeSwitch() {
  const { mode, setMode, role } = useSuggestions();
  const editable = canEdit(role);
  return (
    <div className="vl-segmented" role="radiogroup" aria-label="Editing mode">
      <button
        role="radio"
        aria-checked={mode === "editing" && editable}
        disabled={!editable}
        onClick={() => setMode("editing")}
      >
        Editing
      </button>
      <button
        role="radio"
        aria-checked={mode === "suggesting" || !editable}
        onClick={() => setMode("suggesting")}
      >
        Suggesting
      </button>
    </div>
  );
}
