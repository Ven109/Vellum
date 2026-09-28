import type { CommentThread } from "@vellum/core";
import { relativeTime } from "@vellum/core";
import { Check, CornerDownRight, MessageSquarePlus, RotateCcw, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { createThread, anchorForRange, deleteThread, reply, setResolved } from "../data/comments.js";
import { knownPeople, me, useComments } from "../state/comments.js";
import { useDocSession } from "../state/session.js";

/** Render a comment body with @mentions of known people highlighted. */
export function CommentBody({ body }: { body: string }) {
  const names = knownPeople()
    .map((p) => p.name)
    .sort((a, b) => b.length - a.length);
  if (!names.length) return <>{body}</>;
  const re = new RegExp(
    `(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`,
    "gi",
  );
  return (
    <>
      {body.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="vl-mention">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function CommentComposer() {
  const editor = useDocSession((s) => s.editor);
  const { composing, stopComposing, doc, setActive } = useComments();
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (composing) {
      setBody("");
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [composing]);
  if (!editor || !composing || !doc) return null;
  const coords = editor.view.coordsAtPos(composing.to);

  function submit() {
    if (!editor || !composing || !doc || !body.trim()) return;
    const anchor = anchorForRange(editor, composing.from, composing.to);
    if (!anchor) return;
    const thread = createThread(doc, anchor, me(), body, knownPeople());
    stopComposing();
    setActive(thread.id);
  }

  return (
    <div
      className="vl-comment-composer"
      role="dialog"
      aria-label="New comment"
      style={{ position: "fixed", top: coords.bottom + 8, left: Math.max(16, coords.left - 140) }}
    >
      <textarea
        ref={ref}
        aria-label="Comment"
        placeholder="Add a comment… (@ to mention)"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") stopComposing();
        }}
      />
      <div className="vl-actions">
        <button className="vl-btn vl-btn-primary" disabled={!body.trim()} onClick={submit}>
          Comment
        </button>
        <button className="vl-btn" onClick={stopComposing}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ThreadCard({ thread, quote }: { thread: CommentThread; quote: string }) {
  const { doc, activeId, setActive, positions } = useComments();
  const editor = useDocSession((s) => s.editor);
  const [text, setText] = useState("");
  const active = activeId === thread.id;
  const self = me();

  function jump() {
    setActive(thread.id);
    const pos = positions[thread.id];
    if (editor && pos) {
      editor.commands.setTextSelection(pos.from);
      const dom = editor.view.domAtPos(pos.from).node as HTMLElement;
      (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  return (
    <article
      className="vl-thread-card"
      data-active={active || undefined}
      data-status={thread.status}
      aria-label={`Comment on “${quote}”`}
      onClick={jump}
    >
      <blockquote className="vl-thread-quote">{quote || thread.anchor.quote}</blockquote>
      {(thread.orphaned || positions[thread.id] === null) && (
        <p className="vl-muted vl-small-text">The text this was about was deleted.</p>
      )}
      {thread.comments.map((c) => (
        <div key={c.id} className="vl-comment">
          <div className="vl-comment-head">
            <strong>{c.authorId === self.id ? "You" : (c.authorName ?? "Someone")}</strong>
            <span className="vl-muted" title={new Date(c.createdAt).toLocaleString()}>
              {relativeTime(c.createdAt)}
              {c.editedAt ? " · edited" : ""}
            </span>
          </div>
          <p>
            <CommentBody body={c.body} />
          </p>
        </div>
      ))}
      {active && doc && (
        <div className="vl-thread-actions" onClick={(e) => e.stopPropagation()}>
          {thread.status === "open" && (
            <form
              className="vl-reply"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                reply(doc, thread.id, self, text, knownPeople());
                setText("");
              }}
            >
              <CornerDownRight size={14} aria-hidden />
              <input
                className="vl-input"
                aria-label="Reply"
                placeholder="Reply…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </form>
          )}
          <div className="vl-actions">
            {thread.status === "open" ? (
              <button className="vl-btn" onClick={() => setResolved(doc, thread.id, true, self)}>
                <Check size={13} /> Resolve
              </button>
            ) : (
              <button className="vl-btn" onClick={() => setResolved(doc, thread.id, false, self)}>
                <RotateCcw size={13} /> Reopen
              </button>
            )}
            {thread.comments[0]?.authorId === self.id && (
              <button
                className="vl-icon-btn"
                aria-label="Delete thread"
                onClick={() => {
                  if (window.confirm("Delete this comment thread?")) deleteThread(doc, thread.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** Comment list for the right rail: open threads in document order, detached ones, and resolved. */
export function CommentsSection() {
  const { threads, positions } = useComments();
  const editor = useDocSession((s) => s.editor);
  const [showResolved, setShowResolved] = useState(false);
  const quoteOf = (t: CommentThread) => {
    const p = positions[t.id];
    if (!p || !editor) return t.anchor.quote;
    // Positions are recomputed shortly after edits; until then they may point past the end.
    const size = editor.state.doc.content.size;
    if (p.to > size || p.from >= p.to) return t.anchor.quote;
    return editor.state.doc.textBetween(p.from, p.to, " ", " ");
  };
  const isDetached = (t: CommentThread) => t.orphaned || positions[t.id] === null;
  const open = threads.filter((t) => t.status === "open" && !isDetached(t));
  const detached = threads.filter((t) => t.status === "open" && isDetached(t));
  const resolved = threads.filter((t) => t.status === "resolved");

  return (
    <section aria-label="Comments">
      <h2 className="vl-rail-heading">
        Comments {open.length > 0 && <span className="vl-count">{open.length}</span>}
      </h2>
      {open.length === 0 && detached.length === 0 && (
        <p className="vl-muted">
          <MessageSquarePlus size={13} /> Select text and choose Comment to start a thread.
        </p>
      )}
      <div className="vl-threads">
        {open.map((t) => (
          <ThreadCard key={t.id} thread={t} quote={quoteOf(t)} />
        ))}
      </div>
      {detached.length > 0 && (
        <>
          <h3 className="vl-rail-subheading">Detached</h3>
          <div className="vl-threads">
            {detached.map((t) => (
              <ThreadCard key={t.id} thread={t} quote={t.anchor.quote} />
            ))}
          </div>
        </>
      )}
      {resolved.length > 0 && (
        <button className="vl-link" onClick={() => setShowResolved((s) => !s)} aria-expanded={showResolved}>
          {showResolved ? "Hide" : "Show"} {resolved.length} resolved
        </button>
      )}
      {showResolved && (
        <div className="vl-threads">
          {resolved.map((t) => (
            <ThreadCard key={t.id} thread={t} quote={quoteOf(t)} />
          ))}
        </div>
      )}
    </section>
  );
}
