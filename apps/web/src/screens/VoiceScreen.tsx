import { meterValue } from "@vellum/voice";
import type { Constraint } from "@vellum/voice";
import { ArrowLeft, Hand, Mic, MicOff, Pause, Play, PhoneOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { displayTitle } from "../components/Sidebar.js";
import { useApp } from "../state/app.js";
import { docPath, navigate } from "../state/router.js";
import { useVoiceSession } from "../voice/session.js";
import { DocumentPane } from "./EditorScreen.js";

const STATUS_TEXT = {
  idle: "Not listening",
  starting: "Starting…",
  listening: "Listening",
  hearing: "Hearing you",
  thinking: "Thinking",
  error: "Stopped",
} as const;

const INTENT_LABEL = {
  content: "for the page",
  constraint: "constraint",
  steer: "instruction",
  brief: "brief",
  thinking: "thinking aloud",
} as const;

/** The live mic: a level orb that swells as you speak. */
function Orb() {
  const level = useVoiceSession((s) => s.level);
  const status = useVoiceSession((s) => s.status);
  const muted = useVoiceSession((s) => s.muted);
  const v = muted ? 0 : meterValue(level);
  return (
    <span
      className="vl-orb"
      data-state={muted ? "muted" : status}
      style={{ "--level": v.toFixed(2) } as React.CSSProperties}
      role="img"
      aria-label={muted ? "Microphone muted" : `Microphone ${status === "hearing" ? "hearing you" : "on"}`}
    />
  );
}

function ConstraintChip({ c }: { c: Constraint }) {
  const { editConstraint, removeConstraint } = useVoiceSession.getState();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(c.label);
  if (editing)
    return (
      <li className="vl-chip vl-chip-editing">
        <input
          className="vl-input"
          aria-label={`Edit constraint ${c.label}`}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              editConstraint(c.id, value.trim());
              setEditing(false);
            } else if (e.key === "Escape") {
              setValue(c.label);
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (value.trim() && value.trim() !== c.label) editConstraint(c.id, value.trim());
            setEditing(false);
          }}
        />
      </li>
    );
  return (
    <li className="vl-chip" title={`You said: “${c.source}”`}>
      <button className="vl-chip-label" onClick={() => setEditing(true)} aria-label={`${c.label} (edit)`}>
        {c.label}
      </button>
      <button
        className="vl-chip-x"
        aria-label={`Remove constraint ${c.label}`}
        onClick={() => removeConstraint(c.id)}
      >
        <X size={12} />
      </button>
    </li>
  );
}

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Transcript() {
  const turns = useVoiceSession((s) => s.turns);
  const focused = useVoiceSession((s) => s.focusedTurn);
  const status = useVoiceSession((s) => s.status);
  const interim = useVoiceSession((s) => s.interim);
  const constraints = useVoiceSession((s) => s.constraints);
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer browsers return a promise from scrollIntoView, which React would take as cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length, interim]);
  useEffect(() => {
    if (focused) document.getElementById(`turn-${focused}`)?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  return (
    <section className="vl-voice-transcript" aria-label="Conversation">
      {constraints.length > 0 && (
        <ul className="vl-chips" aria-label="Constraints">
          {constraints.map((c) => (
            <ConstraintChip key={c.id} c={c} />
          ))}
        </ul>
      )}
      <ol
        className="vl-turns"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Transcript"
      >
        {turns.length === 0 && (
          <li className="vl-muted vl-turn-empty">
            Say what you're writing and who it's for, or just start talking. Rules like “keep it under 800
            words” become constraints; everything else goes on the page.
          </li>
        )}
        {turns.map((t) => (
          <li
            key={t.id}
            id={`turn-${t.id}`}
            className="vl-turn"
            data-speaker={t.speaker}
            aria-current={focused === t.id ? "true" : undefined}
            onClick={() =>
              t.speaker === "you" && useVoiceSession.getState().focusTurn(focused === t.id ? null : t.id)
            }
          >
            <span className="vl-turn-who">
              {t.speaker === "you" ? "You" : "Vellum"}{" "}
              <time dateTime={new Date(t.at).toISOString()}>{timeOf(t.at)}</time>
            </span>
            <p>{t.text}</p>
            {t.intents?.length ? (
              <span className="vl-turn-tags">{t.intents.map((i) => INTENT_LABEL[i]).join(" · ")}</span>
            ) : null}
          </li>
        ))}
      </ol>
      {turns.length > 0 && status === "idle" && (
        <button
          className="vl-btn vl-btn-quiet vl-delete-transcript"
          onClick={() => {
            if (window.confirm("Delete this document's voice transcript? The text written from it stays."))
              useVoiceSession.getState().clearTranscript();
          }}
        >
          Delete transcript
        </button>
      )}
      {interim && (
        <p className="vl-interim" data-testid="interim-transcript" aria-live="off">
          {interim}
        </p>
      )}
      <div ref={end} />
    </section>
  );
}

function VoiceStackPanel() {
  const stack = useVoiceSession((s) => s.stack);
  const latency = useVoiceSession((s) => s.latency);
  const status = useVoiceSession((s) => s.status);
  return (
    <aside className="vl-voice-stack" aria-label="Voice stack">
      <h2 className="vl-rail-heading">Voice stack</h2>
      {stack ? (
        <dl>
          <dt>Microphone</dt>
          <dd>{stack.microphone}</dd>
          <dt>Recognition</dt>
          <dd>{stack.recognition}</dd>
          <dt>Your audio goes to</dt>
          <dd data-testid="audio-to" data-local={stack.audioLocal || undefined}>
            {stack.audioTo}
          </dd>
          <dt>Writing</dt>
          <dd>{stack.model ?? "No AI provider: writing down what you say"}</dd>
          <dt>Voice</dt>
          <dd>{stack.voice}</dd>
          <dt>Reaction</dt>
          <dd data-testid="reaction">
            {latency?.count
              ? `${latency.p95} ms (95th pct, budget ${latency.budgetMs} ms)`
              : status === "idle"
                ? "—"
                : "Waiting for your first turn"}
          </dd>
        </dl>
      ) : (
        <p className="vl-muted">Start a session to see what's listening, writing and speaking.</p>
      )}
      <p className="vl-muted vl-voice-settings-link">
        <a
          href="/settings/voice-mode"
          onClick={(e) => {
            e.preventDefault();
            navigate("/settings/voice-mode");
          }}
        >
          Voice settings
        </a>
      </p>
    </aside>
  );
}

function InstructionCard() {
  const pending = useVoiceSession((s) => s.pending);
  const { applyNow, queueIt, ignore } = useVoiceSession.getState();
  if (!pending) return null;
  return (
    <div className="vl-instruction-card" role="alertdialog" aria-label="Heard an instruction">
      <p className="vl-muted">Heard an instruction while writing</p>
      <p className="vl-instruction-text">“{pending.text}”</p>
      <p className="vl-muted" data-testid="instruction-default">
        Applying it after this sentence, unless you choose otherwise.
      </p>
      <div className="vl-actions">
        <button className="vl-btn vl-btn-primary" onClick={applyNow}>
          Apply now
        </button>
        <button className="vl-btn" onClick={queueIt}>
          Queue it
        </button>
        <button className="vl-btn" onClick={ignore}>
          Ignore
        </button>
      </div>
    </div>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Announces what the agent is doing for screen readers (the transcript itself is a live log). */
function Announcer() {
  const writing = useVoiceSession((s) => s.agentWriting);
  const status = useVoiceSession((s) => s.status);
  const error = useVoiceSession((s) => s.error);
  const [message, setMessage] = useState("");
  useEffect(() => setMessage(writing ? "Vellum is writing." : ""), [writing]);
  useEffect(() => {
    if (status === "listening") setMessage("Listening.");
    if (status === "idle") setMessage("Microphone off.");
  }, [status]);
  useEffect(() => {
    if (error) setMessage(error);
  }, [error]);
  return (
    <p className="vl-sr-only" aria-live="assertive" data-testid="announcer">
      {message}
    </p>
  );
}

/** Talk a piece through: the transcript on one side, the document writing itself on the other. */
export function VoiceScreen({ docId }: { docId: string }) {
  const meta = useApp((s) => s.documents.find((d) => d.id === docId));
  const s = useVoiceSession();
  const running = s.status !== "idle" && s.status !== "error";
  const micOn = running && s.status !== "starting" && !s.muted;

  // Mic on is unmistakable, even from another tab: the page title says so.
  useEffect(() => {
    if (!micOn) return;
    const before = document.title;
    document.title = `● Mic on · ${before}`;
    return () => {
      document.title = before;
    };
  }, [micOn]);

  // Keyboard only: Ctrl/⌘ Shift Space starts and ends a session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const v = useVoiceSession.getState();
        if (v.status === "idle" || v.status === "error") void v.start(docId);
        else void v.end();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docId]);

  // The transcript is shown before a session starts and after it ends; leaving the screen ends it.
  useEffect(() => {
    void useVoiceSession.getState().open(docId);
    return () => {
      const session = useVoiceSession.getState();
      void session.end();
      session.close();
    };
  }, [docId]);

  if (!meta) {
    return (
      <main className="vl-main vl-empty">
        <p>This document doesn’t exist or was deleted.</p>
      </main>
    );
  }

  return (
    <main className="vl-main vl-voice" data-live={running || undefined}>
      <header className="vl-voice-bar">
        <a
          className="vl-btn"
          href={docPath(docId)}
          onClick={(e) => {
            e.preventDefault();
            navigate(docPath(docId));
          }}
        >
          <ArrowLeft size={14} /> <span className="vl-btn-label">Back to editor</span>
        </a>
        <h1 className="vl-voice-title">{displayTitle(meta.title)}</h1>
        {running && (
          <span className="vl-mic-pill" data-on={micOn || undefined} data-testid="mic-pill">
            <span aria-hidden>●</span> {micOn ? "Mic on" : s.muted ? "Mic muted" : "Mic starting"}
          </span>
        )}
        <span className="vl-voice-status" role="status" data-testid="voice-status" data-state={s.status}>
          {running && <Orb />}
          {s.muted && running ? "Muted" : STATUS_TEXT[s.status]}
        </span>
        {s.agentSpeaking && (
          <span className="vl-agent-speaking" data-testid="agent-speaking">
            Vellum is speaking · talk to interrupt
          </span>
        )}
        <div className="vl-voice-controls">
          {running ? (
            <>
              <button className="vl-btn" aria-pressed={s.muted} onClick={() => s.setMuted(!s.muted)}>
                {s.muted ? <MicOff size={14} /> : <Mic size={14} />} {s.muted ? "Unmute" : "Mute"}
              </button>
              <button
                className="vl-btn vl-btn-danger"
                onClick={() => void s.end()}
                aria-keyshortcuts="Control+Shift+Space Meta+Shift+Space"
                title={`End session (${MOD} Shift Space)`}
              >
                <PhoneOff size={14} /> End session
              </button>
            </>
          ) : (
            <button
              className="vl-btn vl-btn-primary"
              onClick={() => void s.start(docId)}
              aria-keyshortcuts="Control+Shift+Space Meta+Shift+Space"
              title={`Start talking (${MOD} Shift Space)`}
            >
              <Mic size={14} /> Start talking
            </button>
          )}
        </div>
      </header>
      {s.error && (
        <p className="vl-notice vl-voice-error" role="alert">
          {s.error}{" "}
          {s.error.includes("Settings") && (
            <a
              href="/settings/voice-mode"
              onClick={(e) => {
                e.preventDefault();
                navigate("/settings/voice-mode");
              }}
            >
              Open voice settings
            </a>
          )}
        </p>
      )}
      <div className="vl-voice-body">
        <VoiceStackPanel />
        <Transcript />
        <section className="vl-voice-doc" aria-label="Document">
          <div className="vl-voice-doc-bar">
            {s.agentWriting && (
              <span className="vl-agent-badge" data-testid="agent-writing">
                <span className="vl-agent-dot" aria-hidden /> Agent writing
              </span>
            )}
            {s.writingPaused && (
              <span className="vl-muted">Writing paused{s.queued ? ` · ${s.queued} waiting` : ""}</span>
            )}
            <span className="vl-toolbar-spacer" />
            {running &&
              (s.writingPaused ? (
                <button className="vl-btn" onClick={s.resumeWriting}>
                  <Play size={14} /> Resume writing
                </button>
              ) : (
                <button className="vl-btn" onClick={s.pauseWriting}>
                  <Pause size={14} /> Pause writing
                </button>
              ))}
            {running && (
              <button className="vl-btn" onClick={s.takeOver}>
                <Hand size={14} /> Take over
              </button>
            )}
          </div>
          {s.focusedTurn && (
            <style>{`.vl-voice-doc [data-turn="${CSS.escape(s.focusedTurn)}"] { background: var(--ai); box-shadow: -8px 0 0 var(--ai); }`}</style>
          )}
          <div
            className="vl-scroll"
            onClick={(e) => {
              // Click a paragraph the agent wrote to see the turn it came from.
              const el = (e.target as HTMLElement).closest("[data-turn]");
              useVoiceSession.getState().focusTurn(el?.getAttribute("data-turn") ?? null);
            }}
          >
            <DocumentPane docId={docId} primary meta={meta} />
          </div>
        </section>
      </div>
      <InstructionCard />
      <Announcer />
    </main>
  );
}
