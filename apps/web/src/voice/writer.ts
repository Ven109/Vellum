import type { Editor } from "@tiptap/core";
import { docToMarkdown } from "@vellum/editor";
import { extractJson } from "@vellum/voice";
import type { Llm, WriteAction } from "@vellum/voice";

export interface WriterOptions {
  editor: () => Editor | null;
  llm: () => Llm | null;
  /** The system prompt for drafting: house rules, voice, brief and constraints. */
  system: () => string;
  onWriting?: (writing: boolean) => void;
}

const COMPOSE_TAIL = `Write only the new text to add at the end of the draft, as plain paragraphs separated by blank lines.
No preamble, no headings unless asked, no commentary, no quotation marks around the whole thing.`;

const REVISE_TAIL = `Change the draft as asked. The draft's paragraphs are numbered. Reply with JSON only:
{"edits":[{"paragraph":<number>,"text":"<the paragraph's new text, or empty to delete it>"}]}
Only include paragraphs you change.`;

/** Top-level text blocks with their positions, numbered from 1. */
function paragraphs(editor: Editor) {
  const out: Array<{ n: number; pos: number; size: number; text: string }> = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.isTextblock)
      out.push({ n: out.length + 1, pos: offset, size: node.nodeSize, text: node.textContent });
  });
  return out;
}

/**
 * Carries out the conversation's write actions in the live document. Text is appended as it streams from
 * the model, so the writer watches the draft grow.
 */
export class DocWriter {
  private controller: AbortController | null = null;
  writing = false;

  constructor(private readonly o: WriterOptions) {}

  private set(writing: boolean) {
    this.writing = writing;
    this.o.onWriting?.(writing);
  }

  stop() {
    this.controller?.abort();
  }

  /** Returns what happened, for the transcript ("" when nothing needed saying). */
  async run(action: WriteAction): Promise<string> {
    const editor = this.o.editor();
    if (!editor) return "";
    if (action.type === "insert") {
      this.insertParagraph(editor, action.text, action.position === "start" ? "start" : "end");
      return "";
    }
    const llm = this.o.llm();
    if (!llm) {
      // Without an AI provider the words still land on the page.
      if (action.type === "compose" && action.material.length) {
        this.insertParagraph(editor, action.material.join(" "), "end");
        return "";
      }
      return "Drafting and revising need an AI provider. I'm writing down what you say for now.";
    }
    const controller = new AbortController();
    this.controller = controller;
    this.set(true);
    try {
      return action.type === "compose"
        ? await this.compose(editor, llm, action, controller.signal)
        : await this.revise(editor, llm, action.instruction, controller.signal);
    } catch (e) {
      if ((e as { name?: string; code?: string })?.name === "AbortError" || controller.signal.aborted)
        return "";
      return `I couldn't write that: ${(e as Error).message}`;
    } finally {
      if (this.controller === controller) this.controller = null;
      this.set(false);
    }
  }

  private insertParagraph(editor: Editor, text: string, where: "start" | "end") {
    const node = { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
    const first = editor.state.doc.firstChild;
    const onlyEmpty = editor.state.doc.childCount === 1 && first?.isTextblock && first.content.size === 0;
    if (onlyEmpty) editor.chain().insertContentAt({ from: 0, to: editor.state.doc.content.size }, node).run();
    else
      editor
        .chain()
        .insertContentAt(where === "start" ? 0 : editor.state.doc.content.size, node)
        .run();
  }

  private async compose(
    editor: Editor,
    llm: Llm,
    action: Extract<WriteAction, { type: "compose" }>,
    signal: AbortSignal,
  ) {
    const draft = docToMarkdown(editor.state.doc).trim();
    const material = action.material.length
      ? `\n\nWhat the writer just said (keep their points and their specific words where you can):\n${action.material.map((m) => `- ${m}`).join("\n")}`
      : "";
    const user = `${action.instruction}${material}\n\nThe draft so far:\n<draft>\n${draft || "(empty)"}\n</draft>\n\n${COMPOSE_TAIL}`;
    let buffer = "";
    let started = false;
    const flush = (final: boolean) => {
      // Write whole paragraphs as they complete; the last one when the stream ends.
      const parts = buffer.split(/\n\s*\n/);
      const ready = final ? parts : parts.slice(0, -1);
      buffer = final ? "" : parts.at(-1)!;
      for (const p of ready.map((x) => x.trim()).filter(Boolean)) {
        this.insertParagraph(editor, p.replace(/^["“]|["”]$/g, ""), "end");
        started = true;
      }
    };
    for await (const chunk of llm({
      system: this.o.system(),
      messages: [{ role: "user", content: user }],
      maxTokens: 2000,
      signal,
    })) {
      buffer += chunk;
      flush(false);
    }
    flush(true);
    return started ? "" : "I didn't have anything to add there.";
  }

  private async revise(editor: Editor, llm: Llm, instruction: string, signal: AbortSignal) {
    const list = paragraphs(editor);
    if (!list.some((p) => p.text.trim())) return "There's nothing to change yet.";
    const numbered = list.map((p) => `[${p.n}] ${p.text}`).join("\n\n");
    let reply = "";
    for await (const chunk of llm({
      system: this.o.system(),
      messages: [{ role: "user", content: `${instruction}\n\nThe draft:\n${numbered}\n\n${REVISE_TAIL}` }],
      maxTokens: 3000,
      signal,
    }))
      reply += chunk;
    const edits = (
      (extractJson(reply) as { edits?: Array<{ paragraph?: number; text?: string }> } | null)?.edits ?? []
    )
      .filter((e) => typeof e.paragraph === "number" && typeof e.text === "string")
      .sort((a, b) => b.paragraph! - a.paragraph!); // back to front, so positions stay valid
    if (!edits.length) return "I wasn't sure what to change. Could you say it another way?";
    const current = paragraphs(editor);
    let tr = editor.state.tr;
    for (const e of edits) {
      const p = current.find((x) => x.n === e.paragraph);
      if (!p) continue;
      const text = e.text!.trim();
      if (!text) tr = tr.delete(p.pos, p.pos + p.size);
      else tr = tr.replaceWith(p.pos + 1, p.pos + p.size - 1, editor.schema.text(text));
    }
    editor.view.dispatch(tr);
    return "";
  }
}
