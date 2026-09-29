import { describe, expect, it } from "vitest";
import {
  ConversationLoop,
  applyTurn,
  classify,
  classifyTurn,
  emptyConversation,
  extractJson,
  parseConstraint,
  parseNumber,
  writerContext,
} from "../src/index.js";
import type { Llm, Segment } from "../src/index.js";

const intents = (text: string) => classifyTurn(text).map((s) => s.intent);

describe("numbers", () => {
  it("reads digits and words", () => {
    expect(parseNumber("800")).toBe(800);
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("1.5k")).toBe(1500);
    expect(parseNumber("eight hundred")).toBe(800);
    expect(parseNumber("two thousand five hundred")).toBe(2500);
    expect(parseNumber("a thousand")).toBe(1000);
    expect(parseNumber("twenty-five")).toBe(25);
    expect(parseNumber("lots")).toBeNull();
  });
});

describe("content versus instructions", () => {
  it("the defining case: a sentence to use is content, a length limit is a constraint", () => {
    expect(classifyTurn("Every workshop has one tool nobody talks about.")).toEqual([
      { intent: "content", text: "Every workshop has one tool nobody talks about." },
    ]);
    const [seg] = classifyTurn("Keep it under 800 words.");
    expect(seg).toMatchObject({
      intent: "constraint",
      constraint: { kind: "length", maxWords: 800, label: "Under 800 words" },
    });
  });

  it("splits a mixed turn", () => {
    const segs = classifyTurn(
      "Every workshop has one tool nobody talks about. It's usually the cheapest thing on the wall. Keep it under eight hundred words. Hmm, let me think.",
    );
    expect(segs.map((s) => s.intent)).toEqual(["content", "constraint", "thinking"]);
    expect(segs[0]!.text).toBe(
      "Every workshop has one tool nobody talks about. It's usually the cheapest thing on the wall.",
    );
    expect(segs[1]!.constraint?.maxWords).toBe(800);
  });

  it.each([
    ["Make the opening punchier.", "steer"],
    ["Scratch that last sentence.", "steer"],
    ["Can you add a paragraph about sharpening?", "steer"],
    ["Move the story about my grandfather to the end.", "steer"],
    ["I'm writing an essay about the tools nobody notices.", "brief"],
    ["It's a piece for people just starting woodworking.", "brief"],
    ["Um.", "thinking"],
    ["Where was I.", "thinking"],
    ["What else could go in here?", "thinking"],
    ["The block plane lives in my apron pocket.", "content"],
    ["My grandfather never bought a new chisel in his life.", "content"],
  ])("%s → %s", (text, intent) => {
    expect(intents(text)).toEqual([intent]);
  });

  it("treats dictated quotations as exact words, with where they go", () => {
    expect(classifyTurn("Start with: every workshop has one tool nobody talks about.")).toEqual([
      {
        intent: "content",
        text: "every workshop has one tool nobody talks about.",
        verbatim: true,
        position: "start",
      },
    ]);
    expect(classifyTurn("Quote, measure twice and cut once, end quote.")[0]).toMatchObject({
      verbatim: true,
      text: "measure twice and cut once",
    });
  });
});

describe("constraints", () => {
  it.each([
    ["No more than 1,200 words.", { kind: "length", maxWords: 1200 }],
    ["At least five hundred words.", { kind: "length", minWords: 500 }],
    ["Aim for about 900 words.", { kind: "length", targetWords: 900 }],
    ["Keep it warm.", { kind: "tone", value: "warm" }],
    ["Make it more conversational.", { kind: "tone", value: "conversational" }],
    ["Write it in the first person.", { kind: "person", value: "first" }],
    ["Use headings.", { kind: "format", value: "headings" }],
    ["No headings.", { kind: "format", value: "no-headings" }],
    ["Call it The Quiet Tool.", { kind: "title", value: "The Quiet Tool" }],
    ["Don't mention prices.", { kind: "avoid", value: "prices" }],
    ["It's for people who have never held a chisel.", { kind: "audience" }],
  ])("%s", (text, expected) => {
    expect(parseConstraint(text)).toMatchObject(expected);
  });

  it("isn't fooled by content that mentions numbers or tone words", () => {
    expect(parseConstraint("I spent 800 hours in that shed.")).toBeNull();
    expect(parseConstraint("The light was warm on the bench.")).toBeNull();
  });
});

describe("turn planning", () => {
  const turn = (text: string) => ({ id: "t1", text, at: 0 });

  it("drafts content in, inserts exact words, records constraints and ignores thinking aloud", () => {
    const text =
      "Start with: every workshop has one tool nobody talks about. It's usually the cheapest thing there. Keep it under 800 words. Um.";
    const { state, plan } = applyTurn(emptyConversation(), turn(text), classifyTurn(text));
    expect(plan.actions).toEqual([
      {
        type: "insert",
        text: "every workshop has one tool nobody talks about.",
        position: "start",
        turnId: "t1",
      },
      {
        type: "compose",
        instruction: expect.stringContaining("Work these points"),
        material: ["It's usually the cheapest thing there."],
        turnId: "t1",
      },
    ]);
    expect(plan.reply).toBe("Under 800 words, noted.");
    expect(state.constraints).toHaveLength(1);
    expect(state.turns[0]).toMatchObject({ speaker: "you", intents: ["content", "constraint", "thinking"] });
  });

  it("a new length limit replaces the old one", () => {
    let s = emptyConversation();
    for (const t of ["Keep it under 800 words.", "Actually, keep it under 600 words.", "Keep it warm."])
      s = applyTurn(s, turn(t), classifyTurn(t)).state;
    expect(s.constraints.map((c) => c.label)).toEqual(["Under 600 words", "Tone: warm"]);
  });

  it("the first brief starts a draft; steering revises or composes", () => {
    const brief = "I'm writing an essay about the tools nobody notices.";
    const a = applyTurn(emptyConversation(), turn(brief), classifyTurn(brief));
    expect(a.plan.actions).toEqual([
      { type: "compose", instruction: "Start the draft from the brief.", material: [], turnId: "t1" },
    ]);
    expect(a.plan.reply).toBe("Got it.");
    const revise = applyTurn(
      a.state,
      turn("Make the opening punchier."),
      classifyTurn("Make the opening punchier."),
    );
    expect(revise.plan.actions[0]).toMatchObject({
      type: "revise",
      instruction: "Make the opening punchier.",
    });
    const more = applyTurn(
      a.state,
      turn("Add a paragraph about sharpening."),
      classifyTurn("Add a paragraph about sharpening."),
    );
    expect(more.plan.actions[0]).toMatchObject({
      type: "compose",
      instruction: "Add a paragraph about sharpening.",
    });
    expect(writerContext(revise.state)).toContain("the tools nobody notices");
  });

  it("thinking aloud changes nothing", () => {
    const { plan } = applyTurn(
      emptyConversation(),
      turn("Hmm, let me think."),
      classifyTurn("Hmm, let me think."),
    );
    expect(plan).toEqual({ actions: [], reply: null });
  });
});

describe("with the writer's model", () => {
  const llm = (reply: string, delayMs = 0): Llm =>
    async function* ({ signal }) {
      if (delayMs)
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, delayMs);
          signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))));
        });
      for (const part of reply.match(/.{1,7}/gs) ?? []) yield part;
    };

  it("uses the model's segments, and parses constraints locally for consistent chips", async () => {
    const reply =
      'Sure: {"segments":[{"intent":"content","text":"Every workshop has one tool nobody talks about."},{"intent":"constraint","text":"keep it under 800 words"}]}';
    const r = await classify("Every workshop has one tool nobody talks about, and keep it under 800 words.", {
      llm: llm(reply),
    });
    expect(r.by).toBe("model");
    expect(r.segments.map((s: Segment) => s.intent)).toEqual(["content", "constraint"]);
    expect(r.segments[1]!.constraint).toMatchObject({ kind: "length", maxWords: 800 });
  });

  it("falls back to the rules when the model is slow, fails or talks nonsense", async () => {
    expect((await classify("Keep it under 800 words.", { llm: llm("{}", 500), timeoutMs: 50 })).by).toBe(
      "rules",
    );
    const broken: Llm = async function* () {
      yield* [];
      throw new Error("401");
    };
    expect((await classify("Keep it under 800 words.", { llm: broken })).segments[0]!.intent).toBe(
      "constraint",
    );
    const nonsense = await classify("Keep it under 800 words.", {
      llm: llm('{"segments":[{"intent":"poem","text":"x"}]}'),
    });
    expect(nonsense.segments[0]!.intent).toBe("constraint");
  });

  it("extracts JSON from wrapped replies", () => {
    expect(extractJson('```json\n{"a":{"b":"}"}}\n```')).toEqual({ a: { b: "}" } });
    expect(extractJson("no json")).toBeNull();
  });
});

describe("ConversationLoop", () => {
  it("keeps the conversation and lets the writer correct constraints", async () => {
    const loop = new ConversationLoop();
    const seen: number[] = [];
    loop.subscribe((s) => seen.push(s.turns.length));
    const r = await loop.handleTurn("Keep it under 800 words.");
    expect(r.classifiedBy).toBe("rules");
    loop.agentSaid(r.plan.reply!);
    const [c] = loop.state.constraints;
    loop.updateConstraint(c!.id, { label: "Under 700 words" });
    expect(loop.state.constraints[0]!.label).toBe("Under 700 words");
    loop.removeConstraint(c!.id);
    expect(loop.state.constraints).toEqual([]);
    expect(loop.state.turns.map((t) => t.speaker)).toEqual(["you", "agent"]);
    expect(seen).toEqual([1, 2, 2, 2]);
  });
});
