import { QUICK_ACTIONS, formatTokens, formatUsd } from "@vellum/ai";
import { useUsage } from "../data/usage.js";
import { RulesApplied } from "./RulesApplied.js";
import { useRewrite } from "../state/rewrite.js";
import { countWords } from "@vellum/core";
import { AlertTriangle, ArrowUp, KeyRound, RotateCcw, Sparkles, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/app.js";
import { currentSelection, useAssistant } from "../state/assistant.js";
import type { ThreadMessage } from "../state/assistant.js";
import { useProviders } from "../state/providers.js";
import { navigate } from "../state/router.js";
import { useDocSession } from "../state/session.js";

function useSelectionWords(): number {
  const editor = useDocSession((s) => s.editor);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => setN(countWords(currentSelection()));
    update();
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor]);
  return n;
}

function useCountdown(until?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

function Message({ m }: { m: ThreadMessage }) {
  const retry = useAssistant((s) => s.retry);
  const wait = useCountdown(m.error?.retryAt);
  if (m.role === "user") {
    return (
      <div className="vl-msg vl-msg-user">
        <p>{m.text}</p>
        {m.sources && m.sources.length > 0 && (
          <div className="vl-sources" aria-label="Grounded in">
            <span className="vl-muted">Grounded in</span>
            {m.sources.map((s) => (
              <span key={s.kind} className="vl-source" title={s.detail}>
                {s.label} <small>· {s.detail}</small>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="vl-msg vl-msg-assistant" aria-busy={m.streaming || undefined}>
      {m.text && <div className="vl-msg-text">{m.text}</div>}
      {!m.streaming && <RulesApplied rules={m.appliedRules} />}
      {m.streaming && !m.text && <p className="vl-muted">Thinking…</p>}
      {m.error && (
        <div className="vl-msg-error" role="alert">
          <AlertTriangle size={14} /> {m.error.message}
          {m.error.retryable && (
            <button className="vl-btn" disabled={wait > 0} onClick={() => void retry()}>
              <RotateCcw size={13} /> {wait > 0 ? `Try again in ${wait}s` : "Try again"}
            </button>
          )}
          {m.error.message.startsWith("Add an AI provider") && (
            <button className="vl-btn" onClick={() => navigate("/settings/ai")}>
              Set up a provider
            </button>
          )}
        </div>
      )}
      {!m.streaming && m.model && !m.error && (
        <div className="vl-msg-meta" data-testid="message-usage">
          {m.model}
          {m.usage && m.usage.inputTokens + m.usage.outputTokens > 0 && (
            <>
              {" "}
              · {formatTokens(m.usage.inputTokens)} in / {formatTokens(m.usage.outputTokens)} out
              {m.costUsd !== undefined && <> · {formatUsd(m.costUsd)}</>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UsageFooter() {
  const { session, month, load } = useUsage();
  useEffect(() => {
    void load();
  }, [load]);
  const tokens = session.inputTokens + session.outputTokens;
  return (
    <div
      className="vl-usage-footer"
      data-testid="usage-footer"
      title="Estimated from list prices. Your provider bills you directly."
    >
      This session: {formatTokens(tokens)} tokens · {formatUsd(session.requests ? session.costUsd : 0)}
      {session.partialCost && "+"} · This month: {formatUsd(month.costUsd)}
      {month.partialCost && "+"}
    </div>
  );
}

export function AssistantPanel() {
  const { thread, busy, contextMode, setContextMode, send, stop, clear, setOpen } = useAssistant();
  const { providers, loaded, load } = useProviders();
  const workspace = useApp((s) => s.workspace);
  const docWords = useDocSession((s) => s.wordCount);
  const selWords = useSelectionWords();
  const rewriting = useRewrite((r) => r.streaming);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [thread]);
  useEffect(() => {
    if (selWords > 0) setContextMode("selection");
  }, [selWords, setContextMode]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasProvider = providers.length > 0;
  const model = workspace?.settings.defaultModel?.model ?? providers[0]?.defaultModel;
  const attached =
    contextMode === "selection" && selWords > 0
      ? `Selection · ${selWords} words`
      : `Whole draft · ${docWords.toLocaleString()} words`;

  function submit() {
    if (!text.trim()) return;
    void send(text);
    setText("");
  }

  return (
    <aside className="vl-rail vl-assistant" aria-label="Assistant">
      <header className="vl-assistant-head">
        <Sparkles size={16} aria-hidden />
        <h2>Assistant</h2>
        {model && hasProvider && <span className="vl-muted vl-model">{model}</span>}
        <span className="vl-toolbar-spacer" />
        {thread.length > 0 && (
          <button className="vl-icon-btn" aria-label="Clear conversation" onClick={clear}>
            <Trash2 size={15} />
          </button>
        )}
        <button className="vl-icon-btn" aria-label="Close assistant" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </header>

      {loaded && !hasProvider ? (
        <div className="vl-assistant-empty">
          <KeyRound size={22} aria-hidden />
          <h3>Add your own API key to use the assistant</h3>
          <p>
            Vellum doesn’t run AI models or pay for them. Connect Anthropic, OpenAI, an OpenAI-compatible
            endpoint or a local model with Ollama, and requests go straight from here to that provider.
            Everything else in Vellum works without a key.
          </p>
          <button className="vl-btn vl-btn-primary" onClick={() => navigate("/settings/ai")}>
            Set up a provider
          </button>
        </div>
      ) : (
        <>
          <div className="vl-thread" role="log" aria-live="polite">
            {thread.length === 0 && (
              <p className="vl-muted vl-thread-intro">
                Ask about your draft, or select a passage and ask about that. Nothing changes in your document
                unless you accept it.
              </p>
            )}
            {thread.map((m) => (
              <Message key={m.id} m={m} />
            ))}
            <div ref={endRef} />
          </div>

          <div className="vl-pills" role="group" aria-label="Quick actions">
            {QUICK_ACTIONS.filter((a) => a.kind === "rewrite").map((a) => (
              <button
                key={a.id}
                className="vl-pill"
                disabled={busy || rewriting || selWords === 0}
                title={selWords === 0 ? "Select a passage first" : a.instruction}
                onClick={() => void useRewrite.getState().request(a.instruction)}
              >
                {a.label}
              </button>
            ))}
            {QUICK_ACTIONS.filter((a) => a.kind === "ask").map((a) => (
              <button
                key={a.id}
                className="vl-pill"
                disabled={busy}
                onClick={() => {
                  setContextMode("document");
                  void send(a.instruction);
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          <form
            className="vl-composer"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="vl-context" role="radiogroup" aria-label="Context to attach">
              <button
                type="button"
                role="radio"
                aria-checked={contextMode === "selection" && selWords > 0}
                disabled={selWords === 0}
                onClick={() => setContextMode("selection")}
              >
                Selection
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={contextMode === "document" || selWords === 0}
                onClick={() => setContextMode("document")}
              >
                Whole draft
              </button>
              <span className="vl-muted" data-testid="attached-context">
                Attached: {attached}
              </span>
            </div>
            <textarea
              ref={inputRef}
              aria-label="Message the assistant"
              placeholder="Ask anything about this draft…"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="vl-composer-actions">
              {busy ? (
                <button type="button" className="vl-btn" onClick={stop}>
                  <Square size={12} /> Stop
                </button>
              ) : (
                <>
                  {selWords > 0 && contextMode === "selection" && (
                    <button
                      type="button"
                      className="vl-btn"
                      disabled={!text.trim() || rewriting}
                      onClick={() => {
                        void useRewrite.getState().request(text.trim());
                        setText("");
                      }}
                    >
                      Rewrite selection
                    </button>
                  )}
                  <button
                    type="submit"
                    className="vl-btn vl-btn-primary"
                    disabled={!text.trim()}
                    aria-label="Send"
                  >
                    <ArrowUp size={14} /> Send
                  </button>
                </>
              )}
            </div>
          </form>
          <UsageFooter />
        </>
      )}
    </aside>
  );
}
