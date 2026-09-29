import type { Editor } from "@tiptap/core";
import type { VersionAuthor } from "@vellum/core";
import { AGENT_META, AgentStream, docToMarkdown } from "@vellum/editor";
import { BoundaryGate, extractJson } from "@vellum/voice";
import type { Llm, WriteAction } from "@vellum/voice";
import { recordVersion } from "../data/versions.js";

export interface WriterOptions {
  editor: () => Editor | null;
  llm: () => Llm | null;
  /** The system prompt for drafting: house rules, voice, brief and constraints. */
  system: () => string;
  onWriting?: (writing: boolean) => void;
  /** For history: which document, and who the agent writes on behalf of. */
  attribution?: () => { docId: string; userId: string; providerId: string; model: string } | null;
}

export const YIELD_NOTE =
  "You're writing in that paragraph, so I've stopped there. Tell me when to carry on.";

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
 * Carries out the conversation's write actions in the live document. Drafting streams in word by word,
 * marked while in flight, and the writer can type at the same time; if they type in the paragraph being
 * written, the agent yields and says so.
 */
export class DocWriter {
  private controller: AbortController | null = null;
  private gate: BoundaryGate | null = null;
  private stream: AgentStream | null = null;
  private stopAtWord = false;
  private decided: (() => void) | null = null;
  writing = false;
  /** Called when a "finish the sentence, then stop" completes. */
  onSentenceDone?: () => void;

  constructor(private readonly o: WriterOptions) {}

  private set(writing: boolean) {
    this.writing = writing;
    this.o.onWriting?.(writing);
  }

  stop() {
    this.controller?.abort();
    this.wake();
  }

  private wake() {
    const d = this.decided;
    this.decided = null;
    d?.();
  }

  /** You started talking: finish the word being written, then hold the rest. */
  hold() {
    this.gate?.set("word");
  }

  /** Carry on writing what was held. */
  release() {
    const text = this.gate?.release();
    if (text) this.stream?.write(text);
    this.wake();
  }

  /** Finish the current sentence, then stop (a new instruction goes next). */
  finishSentence() {
    const gate = this.gate;
    if (!gate) return this.onSentenceDone?.();
    gate.set("sentence");
    // Anything already held may complete the sentence straight away.
    const r = gate.feed("");
    if (r.write) this.stream?.write(r.write);
    if (r.stop) this.controller?.abort();
    this.wake();
  }

  /** Stop now, but not mid-word. */
  stopAtNextWord() {
    const gate = this.gate;
    if (!gate) return this.stop();
    gate.set("word");
    if (gate.holding) this.stop();
    else this.stopAtWord = true;
  }

  /**
   * Carry out one action. Returns what to tell the writer ("" when nothing needs saying). The writer's own
   * work is saved as a version first, and what the agent wrote as a version attributed to it.
   */
  async run(action: WriteAction): Promise<string> {
    const editor = this.o.editor();
    if (!editor) return "";
    const who = this.o.attribution?.();
    if (who)
      await recordVersion(
        who.docId,
        docToMarkdown(editor.state.doc),
        { kind: "user", userId: who.userId },
        "checkpoint",
      ).catch(() => null);
    const before = docToMarkdown(editor.state.doc);
    const note = await this.act(editor, action);
    const after = docToMarkdown(editor.state.doc);
    if (who && after !== before) {
      const author: VersionAuthor = {
        kind: "assistant",
        providerId: who.providerId,
        model: who.model,
        requestedBy: who.userId,
      };
      await recordVersion(who.docId, after, author, "assistant").catch(() => null);
    }
    return note;
  }

  private async act(editor: Editor, action: WriteAction): Promise<string> {
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
      if ((e as { name?: string })?.name === "AbortError" || controller.signal.aborted) return "";
      return `I couldn't write that: ${(e as Error).message}`;
    } finally {
      if (this.controller === controller) this.controller = null;
      this.set(false);
    }
  }

  private insertParagraph(editor: Editor, text: string, where: "start" | "end") {
    const s = new AgentStream(editor);
    s.begin(where);
    s.write(text);
    s.end();
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
    const stream = new AgentStream(editor);
    const gate = new BoundaryGate();
    this.stream = stream;
    this.gate = gate;
    this.stopAtWord = false;
    stream.onYield = () => this.controller?.abort();
    stream.begin("end");
    let first = true;
    const settle = () => {
      this.stream = null;
      this.gate = null;
      if (gate.done) this.onSentenceDone?.();
    };
    try {
      for await (let chunk of llm({
        system: this.o.system(),
        messages: [{ role: "user", content: user }],
        maxTokens: 2000,
        signal,
      })) {
        if (first) chunk = chunk.replace(/^\s*["“]/, "");
        first = false;
        const r = gate.feed(chunk);
        if (r.write) stream.write(r.write);
        if (r.stop || (this.stopAtWord && gate.holding)) {
          this.controller?.abort();
          break;
        }
      }
      // The model finished while writing was held for you: wait to hear whether to carry on.
      while (gate.holding && gate.pending && !signal.aborted) {
        await new Promise<void>((resolve) => (this.decided = resolve));
        if (gate.state === "sentence" && !gate.done) {
          const r = gate.feed("");
          if (r.write) stream.write(r.write);
        }
      }
    } catch (e) {
      if (stream.result === "yielded") {
        settle();
        return YIELD_NOTE;
      }
      if (!signal.aborted) {
        stream.end("stopped");
        settle();
        throw e;
      }
    }
    if (stream.result === "yielded") {
      settle();
      return YIELD_NOTE;
    }
    stream.end(signal.aborted ? "stopped" : "done");
    settle();
    return stream.hasWritten || signal.aborted ? "" : "I didn't have anything to add there.";
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
    const tr = editor.state.tr;
    for (const e of edits) {
      const p = current.find((x) => x.n === e.paragraph);
      if (!p) continue;
      const text = e.text!.trim();
      if (!text) tr.delete(p.pos, p.pos + p.size);
      else tr.replaceWith(p.pos + 1, p.pos + p.size - 1, editor.schema.text(text));
    }
    tr.setMeta(AGENT_META, true);
    editor.view.dispatch(tr);
    return "";
  }
}
