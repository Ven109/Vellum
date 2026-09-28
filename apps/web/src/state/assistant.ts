import { ProviderError, adapterFor, buildSystemPrompt, resolveModel } from "@vellum/ai";
import type { ChatMessage, PromptSource, Usage } from "@vellum/ai";
import { docToMarkdown } from "@vellum/editor";
import { create } from "zustand";
import { redact, withKey } from "../data/providers.js";
import { useApp } from "./app.js";
import { useProviders } from "./providers.js";
import { useDocSession } from "./session.js";

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: PromptSource[];
  model?: string;
  usage?: Usage;
  error?: { message: string; retryable: boolean };
  streaming?: boolean;
}

export type ContextMode = "selection" | "document";

interface AssistantState {
  open: boolean;
  thread: ThreadMessage[];
  busy: boolean;
  contextMode: ContextMode;
  controller: AbortController | null;
  setOpen(open: boolean): void;
  toggle(): void;
  setContextMode(mode: ContextMode): void;
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  stop(): void;
  clear(): void;
}

let seq = 0;
const nextId = () => `m${++seq}`;

/** The current editor selection as plain text, if any. */
export function currentSelection(): string {
  const editor = useDocSession.getState().editor;
  if (!editor) return "";
  const { from, to } = editor.state.selection;
  return from === to ? "" : editor.state.doc.textBetween(from, to, "\n\n", " ");
}

/** Resolve the provider + model for the open document, with its key attached for this request only. */
export async function activeProvider() {
  const providers = useProviders.getState();
  if (!providers.loaded) await providers.load();
  const { workspace, documents } = useApp.getState();
  const docId = useDocSession.getState().docId;
  const doc = documents.find((d) => d.id === docId);
  const resolved = resolveModel(
    useProviders.getState().providers,
    workspace?.settings.defaultModel,
    doc?.modelOverride,
  );
  if (!resolved) return null;
  return { provider: await withKey(resolved.provider), model: resolved.model };
}

export function assistantContext(mode: ContextMode) {
  const { workspace, documents } = useApp.getState();
  const { editor, docId } = useDocSession.getState();
  const doc = documents.find((d) => d.id === docId);
  const selection = currentSelection();
  const traits = workspace?.settings.voice.learnFromPublished
    ? workspace.settings.voice.traits.filter((t) => t.enabled).map((t) => t.instruction)
    : [];
  return {
    documentTitle: doc?.title ?? "",
    selection: mode === "selection" && selection ? selection : undefined,
    document: mode === "document" && editor ? docToMarkdown(editor.state.doc) : undefined,
    houseRules: workspace?.settings.houseRules,
    voiceTraits: traits,
  };
}

export const useAssistant = create<AssistantState>((set, get) => ({
  open: false,
  thread: [],
  busy: false,
  contextMode: "document",
  controller: null,

  setOpen(open) {
    set({ open });
  },
  toggle() {
    set({ open: !get().open });
  },
  setContextMode(contextMode) {
    set({ contextMode });
  },

  async send(text) {
    const trimmed = text.trim();
    if (!trimmed || get().busy) return;
    const target = await activeProvider();
    const userMsg: ThreadMessage = { id: nextId(), role: "user", text: trimmed };
    if (!target) {
      set({
        thread: [
          ...get().thread,
          userMsg,
          {
            id: nextId(),
            role: "assistant",
            text: "",
            error: { message: "Add an AI provider key to use the assistant.", retryable: false },
          },
        ],
      });
      return;
    }
    const mode = get().contextMode === "selection" && !currentSelection() ? "document" : get().contextMode;
    const { system, sources } = buildSystemPrompt(assistantContext(mode));
    userMsg.sources = sources;
    const reply: ThreadMessage = {
      id: nextId(),
      role: "assistant",
      text: "",
      streaming: true,
      model: target.model,
    };
    const controller = new AbortController();
    set({ thread: [...get().thread, userMsg, reply], busy: true, controller });

    const history: ChatMessage[] = get()
      .thread.filter((m) => !m.error && m.id !== reply.id && (m.role === "user" || m.text))
      .map((m) => ({ role: m.role, content: m.text }));
    const patch = (p: Partial<ThreadMessage>) =>
      set({ thread: get().thread.map((m) => (m.id === reply.id ? { ...m, ...p } : m)) });

    try {
      let acc = "";
      const usage: Usage = { inputTokens: 0, outputTokens: 0 };
      for await (const ev of adapterFor(target.provider.kind).stream(target.provider, {
        model: target.model,
        system,
        messages: history,
        maxTokens: 4000,
        signal: controller.signal,
      })) {
        if (ev.type === "text") {
          acc += ev.text;
          patch({ text: acc });
        } else if (ev.type === "usage") {
          Object.assign(
            usage,
            Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v !== undefined)),
          );
        } else {
          patch({ model: ev.model });
        }
      }
      patch({ streaming: false, usage });
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError("unknown", String(e));
      if (err.code === "aborted") patch({ streaming: false });
      else
        patch({
          streaming: false,
          error: { message: redact(err.message, [target.provider.apiKey]), retryable: err.retryable },
        });
    } finally {
      set({ busy: false, controller: null });
    }
  },

  async retry() {
    const thread = get().thread;
    const lastUser = [...thread].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Drop the failed exchange but keep the user's words: nothing typed is ever lost.
    const idx = thread.lastIndexOf(lastUser);
    set({ thread: thread.slice(0, idx) });
    await get().send(lastUser.text);
  },

  stop() {
    get().controller?.abort();
  },

  clear() {
    get().controller?.abort();
    set({ thread: [] });
  },
}));
