import { Mark, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

/** Transactions made by the voice agent carry this meta, so they're never mistaken for the writer's. */
export const AGENT_META = "vellumAgent";

/**
 * Text the agent is writing right now. Shown distinctly while in flight and removed when the text
 * settles; it never reaches Markdown or history.
 */
export const AgentText = Mark.create({
  name: "agentText",
  inclusive: false,
  excludes: "",
  parseHTML() {
    return [{ tag: "span[data-agent-writing]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-agent-writing": "", class: "vl-agent-text" }), 0];
  },
});

export const isAgentTransaction = (tr: Transaction) => tr.getMeta(AGENT_META) === true;

export type AgentStreamEnd = "done" | "stopped" | "yielded";

/**
 * Streams the agent's text into the live document while the writer keeps working. Positions are mapped
 * through everyone's edits. If anyone else edits the paragraph the agent is writing in, the agent yields:
 * it stops there and reports it, rather than fighting over the same words.
 */
export class AgentStream {
  private pos = -1;
  /** The paragraph being written, as [start, end) of its content. */
  private para: { from: number; to: number } | null = null;
  private written: Array<{ from: number; to: number }> = [];
  private state: "idle" | "writing" | AgentStreamEnd = "idle";
  private readonly onTransaction: (p: { transaction: Transaction }) => void;
  onYield?: () => void;

  constructor(private readonly editor: Editor) {
    this.onTransaction = ({ transaction: tr }) => {
      if (this.state !== "writing" || !tr.docChanged || isAgentTransaction(tr)) return;
      // Someone else's edit: did it touch the paragraph being written?
      let touched = false;
      if (this.para) {
        const { from, to } = this.para;
        tr.mapping.maps.forEach((map) =>
          map.forEach((oldStart, oldEnd) => {
            if (oldEnd >= from && oldStart <= to) touched = true;
          }),
        );
      }
      this.pos = tr.mapping.map(this.pos);
      if (this.para)
        this.para = { from: tr.mapping.map(this.para.from, -1), to: tr.mapping.map(this.para.to) };
      this.written = this.written.map((r) => ({
        from: tr.mapping.map(r.from),
        to: tr.mapping.map(r.to, -1),
      }));
      if (touched) {
        this.end("yielded");
        this.onYield?.();
      }
    };
    editor.on("transaction", this.onTransaction);
  }

  get writing() {
    return this.state === "writing";
  }

  get result(): AgentStreamEnd | "idle" | "writing" {
    return this.state;
  }

  get hasWritten() {
    return this.written.some((r) => r.to > r.from);
  }

  private dispatch(tr: Transaction) {
    tr.setMeta(AGENT_META, true);
    tr.setMeta("addToHistory", false);
    this.editor.view.dispatch(tr);
  }

  /** Open a new paragraph to write into: at the end of the document, or at the start. */
  begin(where: "start" | "end" = "end") {
    const { state } = this.editor;
    const { doc, schema } = state;
    const tr = state.tr;
    const first = doc.firstChild;
    const onlyEmpty = doc.childCount === 1 && first?.isTextblock && first.content.size === 0;
    let start: number;
    if (onlyEmpty) start = 1;
    else {
      const at = where === "start" ? 0 : doc.content.size;
      tr.insert(at, schema.nodes.paragraph!.create());
      start = at + 1;
    }
    this.dispatch(tr);
    this.pos = start;
    this.para = { from: start, to: start };
    this.state = "writing";
  }

  /** Append streamed text. Blank lines start a new paragraph. */
  write(chunk: string) {
    if (this.state !== "writing" || !chunk) return;
    const parts = chunk.split(/\n\s*\n/);
    parts.forEach((part, i) => {
      if (i > 0) this.newParagraph();
      const text =
        i === 0 && this.pos === this.para?.from ? part.replace(/^\s+/, "") : part.replace(/\n/g, " ");
      if (text) this.insertText(text);
    });
  }

  private insertText(text: string) {
    const { state } = this.editor;
    const mark = state.schema.marks.agentText!.create();
    const tr = state.tr.insert(this.pos, state.schema.text(text, [mark]));
    this.dispatch(tr);
    this.written.push({ from: this.pos, to: this.pos + text.length });
    this.pos += text.length;
    if (this.para) this.para.to = this.pos;
  }

  private newParagraph() {
    const { state } = this.editor;
    const $pos = state.doc.resolve(this.pos);
    // Nothing written in this paragraph yet: keep using it.
    if ($pos.parent.content.size === 0) return;
    const after = $pos.after();
    const tr = state.tr.insert(after, state.schema.nodes.paragraph!.create());
    this.dispatch(tr);
    this.pos = after + 1;
    this.para = { from: this.pos, to: this.pos };
  }

  /** Settle what was written: the in-flight marking comes off, trailing space and empty paragraphs go. */
  end(how: AgentStreamEnd = "done") {
    if (this.state !== "writing") return;
    this.state = how;
    this.editor.off("transaction", this.onTransaction);
    const { state } = this.editor;
    const tr = state.tr;
    const mark = state.schema.marks.agentText!;
    for (const r of this.written)
      if (r.to > r.from) tr.removeMark(r.from, Math.min(r.to, tr.doc.content.size), mark);
    // Drop the paragraph opened for writing if nothing went into it.
    const $pos = tr.doc.resolve(Math.min(this.pos, tr.doc.content.size));
    if ($pos.parent.isTextblock && $pos.parent.content.size === 0 && tr.doc.childCount > 1)
      tr.delete($pos.before(), $pos.after());
    if (tr.docChanged) this.dispatch(tr);
    this.para = null;
  }

  /** Stop listening without touching the document (e.g. the editor is going away). */
  dispose() {
    this.editor.off("transaction", this.onTransaction);
    if (this.state === "writing") this.state = "stopped";
  }
}
