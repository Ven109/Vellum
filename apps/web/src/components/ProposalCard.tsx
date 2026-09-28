import { getProposal, proposalStats } from "@vellum/editor";
import { Check, RotateCcw, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useDocSession } from "../state/session.js";
import { useRewrite } from "../state/rewrite.js";

/** Floating card under a proposed rewrite: Accept / Try again / Discard, the word delta, and Stop. */
export function ProposalCard() {
  const editor = useDocSession((s) => s.editor);
  const { active, streaming, error, model, instruction, accept, tryAgain, discard, stop } = useRewrite();
  const [, force] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const rerender = () => force((n) => n + 1);
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        discard();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !streaming) {
        e.preventDefault();
        void accept();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, streaming, accept, discard]);

  if (!editor || !active) return null;
  const proposal = getProposal(editor.state);

  if (error) {
    return (
      <div className="vl-proposal-card" role="alert" style={{ position: "fixed", right: 24, bottom: 24 }}>
        <span>{error}</span>
        {!error.startsWith("Add an AI provider") && (
          <button className="vl-btn" onClick={() => void tryAgain()}>
            <RotateCcw size={13} /> Try again
          </button>
        )}
        <button className="vl-btn" onClick={discard}>
          Dismiss
        </button>
      </div>
    );
  }
  if (!proposal) return null;

  const coords = editor.view.coordsAtPos(proposal.to);
  const stats = proposalStats(proposal);
  const delta = stats.added - stats.removed;

  return (
    <div
      className="vl-proposal-card"
      role="dialog"
      aria-label="Proposed rewrite"
      style={{
        position: "fixed",
        top: Math.min(window.innerHeight - 64, coords.bottom + 10),
        left: Math.max(16, coords.left - 160),
      }}
    >
      <span className="vl-proposal-label" title={instruction}>
        {streaming ? "Writing…" : "Proposed rewrite"}
      </span>
      {!streaming && (
        <span className="vl-proposal-delta" data-testid="word-delta">
          <span className="vl-plus">+{stats.added}</span> <span className="vl-minus">−{stats.removed}</span>{" "}
          words
          {delta !== 0 && (
            <>
              {" "}
              ({delta > 0 ? "+" : "−"}
              {Math.abs(delta)})
            </>
          )}
        </span>
      )}
      {model && <span className="vl-muted vl-model">{model}</span>}
      {streaming ? (
        <button className="vl-btn" onClick={stop}>
          <Square size={12} /> Stop
        </button>
      ) : (
        <>
          <button
            className="vl-btn vl-btn-primary"
            onClick={() => void accept()}
            title="Accept (Ctrl/⌘ Enter)"
          >
            <Check size={14} /> Accept
          </button>
          <button className="vl-btn" onClick={() => void tryAgain()}>
            <RotateCcw size={13} /> Try again
          </button>
          <button className="vl-btn" onClick={discard} title="Discard (Esc)">
            <X size={14} /> Discard
          </button>
        </>
      )}
    </div>
  );
}
