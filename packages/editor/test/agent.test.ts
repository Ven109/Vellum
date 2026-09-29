import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { AgentStream, docToMarkdown, isAgentTransaction } from "../src/index.js";
import { createEditor } from "./helpers.js";

let editor: Editor;
afterEach(() => editor?.destroy());

const agentMarked = (ed: Editor) => {
  let text = "";
  ed.state.doc.descendants((n) => {
    if (n.isText && n.marks.some((m) => m.type.name === "agentText")) text += n.text;
  });
  return text;
};

const paragraphs = (ed: Editor) => {
  const out: string[] = [];
  ed.state.doc.forEach((n) => out.push(n.textContent));
  return out;
};

describe("AgentStream", () => {
  it("streams text into a new paragraph at the end, marked while in flight", () => {
    editor = createEditor("<p>My opening line.</p>");
    const s = new AgentStream(editor);
    s.begin("end");
    for (const chunk of ["Every work", "shop has one ", "tool.\n\nIt hangs", " by the door."]) s.write(chunk);
    expect(paragraphs(editor)).toEqual([
      "My opening line.",
      "Every workshop has one tool.",
      "It hangs by the door.",
    ]);
    expect(agentMarked(editor)).toBe("Every workshop has one tool.It hangs by the door.");
    s.end();
    expect(agentMarked(editor)).toBe("");
    expect(s.result).toBe("done");
    expect(docToMarkdown(editor.state.doc).trim()).toBe(
      "My opening line.\n\nEvery workshop has one tool.\n\nIt hangs by the door.",
    );
  });

  it("writes into an empty document without leaving an empty paragraph", () => {
    editor = createEditor("");
    const s = new AgentStream(editor);
    s.begin("end");
    s.write("First words.\n\n");
    s.end();
    expect(paragraphs(editor)).toEqual(["First words."]);
  });

  it("can put exact words at the start", () => {
    editor = createEditor("<p>Middle.</p>");
    const s = new AgentStream(editor);
    s.begin("start");
    s.write("Opening.");
    s.end();
    expect(paragraphs(editor)).toEqual(["Opening.", "Middle."]);
  });

  it("keeps writing in the right place while the writer types elsewhere", () => {
    editor = createEditor("<p>Mine.</p>");
    const s = new AgentStream(editor);
    s.begin("end");
    s.write("The agent ");
    // The writer adds to their own paragraph, earlier in the document.
    editor.chain().insertContentAt(5, " And more of mine").run();
    s.write("carries on.");
    s.end();
    expect(paragraphs(editor)).toEqual(["Mine And more of mine.", "The agent carries on."]);
    expect(s.result).toBe("done");
  });

  it("yields when the writer types in the paragraph it's writing", () => {
    editor = createEditor("<p>Mine.</p>");
    const s = new AgentStream(editor);
    let yielded = 0;
    s.onYield = () => yielded++;
    s.begin("end");
    s.write("The agent was writing");
    const end = editor.state.doc.content.size - 1;
    editor.chain().insertContentAt(end, " but I took over").run();
    expect(s.result).toBe("yielded");
    expect(yielded).toBe(1);
    s.write(" and this never lands.");
    expect(paragraphs(editor)).toEqual(["Mine.", "The agent was writing but I took over"]);
    expect(agentMarked(editor)).toBe("");
  });

  it("marks its transactions and keeps them out of undo history", () => {
    editor = createEditor("<p>x</p>");
    const seen: boolean[] = [];
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged)
        seen.push(isAgentTransaction(transaction) && transaction.getMeta("addToHistory") === false);
    });
    const s = new AgentStream(editor);
    s.begin("end");
    s.write("y");
    s.end();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });
});

describe("turn links", () => {
  const turns = (ed: Editor) => {
    const out: Array<string | null> = [];
    ed.state.doc.forEach((n) => out.push((n.attrs.turnId as string | null) ?? null));
    return out;
  };

  it("paragraphs the agent writes remember the turn that produced them", () => {
    editor = createEditor("<p>Mine.</p>");
    const s = new AgentStream(editor);
    s.begin("end", "turn_1");
    s.write("First.\n\nSecond.");
    s.end();
    expect(turns(editor)).toEqual([null, "turn_1", "turn_1"]);
    expect(editor.getHTML()).toContain('<p data-turn="turn_1">First.</p>');
    // Not part of the portable text.
    expect(docToMarkdown(editor.state.doc).trim()).toBe("Mine.\n\nFirst.\n\nSecond.");
  });

  it("also when writing into an empty document, and it survives a round trip through HTML", () => {
    editor = createEditor("");
    const s = new AgentStream(editor);
    s.begin("end", "turn_2");
    s.write("Only.");
    s.end();
    expect(turns(editor)).toEqual(["turn_2"]);
    const html = editor.getHTML();
    editor.destroy();
    editor = createEditor(html);
    expect(turns(editor)).toEqual(["turn_2"]);
  });
});
