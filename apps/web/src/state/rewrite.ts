import { ProviderError, adapterFor, buildSystemPrompt, cleanRewrite, rewriteUserMessage } from "@vellum/ai";
import type { Usage } from "@vellum/ai";
import {
  acceptProposal,
  discardProposal,
  docToMarkdown,
  getProposal,
  startProposal,
  updateProposal,
} from "@vellum/editor";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import { create } from "zustand";
import { redact } from "../data/providers.js";
import { recordVersion } from "../data/versions.js";
import { activeProvider, assistantContext } from "./assistant.js";
import { useApp } from "./app.js";
import { useDocSession } from "./session.js";

interface RewriteState {
  active: boolean;
  streaming: boolean;
  instruction: string;
  error: string | null;
  model: string | null;
  usage: Usage | null;
  controller: AbortController | null;
  /** Range and text the request was made against, reused by Try again. */
  range: { from: number; to: number } | null;
  request(instruction: string): Promise<void>;
  tryAgain(): Promise<void>;
  stop(): void;
  accept(): Promise<void>;
  discard(): void;
}

/**
 * Rewrite pipeline: selection + request → streamed proposal rendered as a diff in the document → the
 * writer accepts (one undoable transaction, recorded as an assistant-attributed version), tries again
 * with the same context, or discards (no trace). Nothing is ever applied silently.
 */
export const useRewrite = create<RewriteState>((set, get) => ({
  active: false,
  streaming: false,
  instruction: "",
  error: null,
  model: null,
  usage: null,
  controller: null,
  range: null,

  async request(instruction) {
    const editor = useDocSession.getState().editor;
    if (!editor || get().streaming) return;
    const sel = editor.state.selection;
    const range = get().range && getProposal(editor.state) ? get().range! : { from: sel.from, to: sel.to };
    if (range.from === range.to) return;
    const target = await activeProvider();
    if (!target) {
      set({ active: true, error: "Add an AI provider key to use rewrites.", instruction, range: null });
      return;
    }
    discardProposal(editor);
    const proposal = startProposal(editor, { from: range.from, to: range.to });
    if (!proposal) return;
    const controller = new AbortController();
    set({
      active: true,
      streaming: true,
      instruction,
      error: null,
      model: target.model,
      usage: null,
      controller,
      range: { from: proposal.from, to: proposal.to },
    });

    const { system } = buildSystemPrompt({ ...assistantContext("document"), selection: undefined });
    let text = "";
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    try {
      for await (const ev of adapterFor(target.provider.kind).stream(target.provider, {
        model: target.model,
        system,
        messages: [{ role: "user", content: rewriteUserMessage(instruction, proposal.original) }],
        maxTokens: 8000,
        signal: controller.signal,
      })) {
        if (ev.type === "text") {
          text += ev.text;
          updateProposal(editor, text.trimStart(), true);
        } else if (ev.type === "usage") {
          if (ev.usage.inputTokens !== undefined) usage.inputTokens = ev.usage.inputTokens;
          if (ev.usage.outputTokens !== undefined) usage.outputTokens = ev.usage.outputTokens;
        } else set({ model: ev.model });
      }
      updateProposal(editor, cleanRewrite(text), false);
      set({ streaming: false, usage });
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError("unknown", String(e));
      if (err.code === "aborted") {
        // Stop keeps what was written so far so the writer can still accept or discard it.
        updateProposal(editor, cleanRewrite(text), false);
        set({ streaming: false, usage });
      } else {
        discardProposal(editor);
        set({ streaming: false, error: redact(err.message, [target.provider.apiKey]) });
      }
    } finally {
      set({ controller: null });
      if (!getProposal(editor.state) && !get().error) set({ active: false, range: null });
    }
  },

  async tryAgain() {
    const { instruction } = get();
    const editor = useDocSession.getState().editor;
    if (!editor) return;
    const p = getProposal(editor.state);
    const range = p ? { from: p.from, to: p.to } : get().range;
    if (!range) return;
    discardProposal(editor);
    editor.commands.setTextSelection(range);
    set({ range: null });
    await get().request(instruction);
  },

  stop() {
    get().controller?.abort();
  },

  async accept() {
    const editor = useDocSession.getState().editor;
    const docId = useDocSession.getState().docId;
    if (!editor || !docId) return;
    // Close the current undo group before and after, so Accept is exactly one undo step even when the
    // writer was typing a moment ago (the CRDT undo manager otherwise merges changes within 500ms).
    const undo = (
      yUndoPluginKey.getState(editor.state) as { undoManager?: { stopCapturing(): void } } | undefined
    )?.undoManager;
    undo?.stopCapturing();
    const applied = acceptProposal(editor);
    undo?.stopCapturing();
    set({ active: false, range: null, error: null });
    if (!applied) return;
    const user = useApp.getState().user;
    const target = await activeProvider();
    await recordVersion(
      docId,
      docToMarkdown(editor.state.doc),
      {
        kind: "assistant",
        providerId: target?.provider.id ?? "unknown",
        model: get().model ?? target?.model ?? "unknown",
        requestedBy: user?.id ?? "unknown",
      },
      "assistant",
    );
  },

  discard() {
    get().controller?.abort();
    const editor = useDocSession.getState().editor;
    if (editor) discardProposal(editor);
    set({ active: false, streaming: false, range: null, error: null });
  },
}));
