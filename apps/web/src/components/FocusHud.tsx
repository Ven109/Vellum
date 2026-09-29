import { Pause, Play, Sparkles, Square, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAssistant } from "../state/assistant.js";
import { useCommands } from "../state/commands.js";
import { sprintRemaining, useFocus } from "../state/focus.js";
import type { Dimming } from "../state/focus.js";
import { useRewrite } from "../state/rewrite.js";
import { useDocSession } from "../state/session.js";

const DIMMING: Array<{ id: Dimming; label: string }> = [
  { id: "typewriter", label: "Typewriter" },
  { id: "paragraph", label: "Paragraph" },
  { id: "off", label: "Off" },
];
const SPRINTS = [10, 25, 45];

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Keeps the line being written near the middle of the screen in typewriter mode. */
function useTypewriterScroll(enabled: boolean) {
  const editor = useDocSession((s) => s.editor);
  useEffect(() => {
    if (!enabled || !editor) return;
    const centre = () => {
      const view = editor.view;
      const scroller = view.dom.closest(".vl-scroll");
      if (!scroller || !view.hasFocus()) return;
      const caret = view.coordsAtPos(view.state.selection.head);
      const box = scroller.getBoundingClientRect();
      const delta = caret.top - (box.top + box.height * 0.45);
      if (Math.abs(delta) > 2) scroller.scrollTop += delta;
    };
    editor.on("selectionUpdate", centre);
    editor.on("update", centre);
    editor.on("focus", centre);
    centre();
    return () => {
      editor.off("selectionUpdate", centre);
      editor.off("update", centre);
      editor.off("focus", centre);
    };
  }, [enabled, editor]);
}

function SprintControl() {
  const { sprint, startSprint, pauseSprint, resumeSprint, cancelSprint, tick } = useFocus();
  const [choosing, setChoosing] = useState(false);
  const now = useNow(sprint?.endsAt ? 250 : 1000);
  useEffect(() => tick(now), [now, tick]);
  const words = useDocSession((s) => s.wordCount);

  if (!sprint) {
    return choosing ? (
      <div className="vl-hud-group" role="group" aria-label="Sprint length">
        {SPRINTS.map((m) => (
          <button
            key={m}
            className="vl-hud-btn"
            onClick={() => {
              startSprint(m);
              setChoosing(false);
            }}
          >
            {m} min
          </button>
        ))}
        <button className="vl-hud-btn" aria-label="Cancel" onClick={() => setChoosing(false)}>
          <X size={13} />
        </button>
      </div>
    ) : (
      <button className="vl-hud-btn" onClick={() => setChoosing(true)}>
        <Timer size={14} /> Sprint
      </button>
    );
  }

  if (sprint.finished) {
    return (
      <div className="vl-hud-group" role="status">
        <span>
          Sprint done · +{sprint.wordsWritten ?? 0} {sprint.wordsWritten === 1 ? "word" : "words"}
        </span>
        <button className="vl-hud-btn" aria-label="Close sprint" onClick={cancelSprint}>
          <X size={13} />
        </button>
      </div>
    );
  }

  const running = sprint.endsAt !== null;
  return (
    <div className="vl-hud-group" role="group" aria-label="Sprint">
      <span className="vl-hud-clock" data-testid="sprint-remaining" aria-label="Sprint time left">
        {formatClock(sprintRemaining(sprint, now))}
      </span>
      <span className="vl-hud-dim">+{Math.max(0, words - sprint.startWords)}</span>
      {running ? (
        <button className="vl-hud-btn" aria-label="Pause sprint" onClick={pauseSprint}>
          <Pause size={13} />
        </button>
      ) : (
        <button className="vl-hud-btn" aria-label="Resume sprint" onClick={resumeSprint}>
          <Play size={13} />
        </button>
      )}
      <button className="vl-hud-btn" aria-label="Stop sprint" onClick={cancelSprint}>
        <Square size={12} />
      </button>
    </div>
  );
}

/** The minimal overlay shown in focus mode. It fades while you type and returns on mouse movement. */
export function FocusHud() {
  const { dimming, setDimming, goal, setGoal, startedAt, startWords, exit } = useFocus();
  const wordCount = useDocSession((s) => s.wordCount);
  const now = useNow();
  const [quiet, setQuiet] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const written = Math.max(0, wordCount - startWords);
  const progress = Math.min(1, written / goal);
  useTypewriterScroll(dimming === "typewriter");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Esc belongs to open proposals, dialogs and the palette first.
        if (useRewrite.getState().active || useCommands.getState().paletteOpen) return;
        if (useAssistant.getState().open) return;
        if (document.querySelector("[role=dialog]")) return;
        exit();
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) setQuiet(true);
    };
    const wake = () => setQuiet(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", wake);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", wake);
    };
  }, [exit]);

  return (
    <div className="vl-hud" data-quiet={quiet || undefined} role="toolbar" aria-label="Focus mode">
      <button className="vl-hud-btn" onClick={exit} aria-label="Exit focus mode" title="Exit (Esc)">
        <X size={15} />
      </button>
      <span className="vl-hud-clock" aria-label="Session time" title="Time in this session">
        {formatClock(now - startedAt)}
      </span>
      <span data-testid="focus-words" title={`${wordCount.toLocaleString()} words in the document`}>
        +{written.toLocaleString()} {written === 1 ? "word" : "words"}
      </span>
      <span className="vl-hud-goal">
        <span
          className="vl-hud-progress"
          role="progressbar"
          aria-label="Goal progress"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(written, goal)}
        >
          <span style={{ width: `${progress * 100}%` }} />
        </span>
        {editingGoal ? (
          <input
            className="vl-hud-input"
            type="number"
            min={1}
            aria-label="Word goal"
            defaultValue={goal}
            autoFocus
            onBlur={(e) => {
              if (Number(e.target.value) > 0) setGoal(Number(e.target.value));
              setEditingGoal(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditingGoal(false);
              }
            }}
          />
        ) : (
          <button className="vl-hud-btn vl-hud-dim" onClick={() => setEditingGoal(true)} title="Change goal">
            {progress >= 1 ? "Goal reached" : `of ${goal.toLocaleString()}`}
          </button>
        )}
      </span>
      <div className="vl-hud-group" role="radiogroup" aria-label="Dimming">
        {DIMMING.map((d) => (
          <button
            key={d.id}
            role="radio"
            aria-checked={dimming === d.id}
            className="vl-hud-btn"
            onClick={() => setDimming(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <SprintControl />
      <button className="vl-hud-btn" onClick={() => useAssistant.getState().setOpen(true)}>
        <Sparkles size={14} /> Ask
      </button>
    </div>
  );
}
