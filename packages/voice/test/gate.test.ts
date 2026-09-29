import { describe, expect, it } from "vitest";
import { BoundaryGate } from "../src/index.js";

function run(gate: BoundaryGate, chunks: string[], at?: { index: number; mode: "word" | "sentence" }) {
  let out = "";
  let stopped = false;
  chunks.forEach((c, i) => {
    if (at && i === at.index) gate.set(at.mode);
    if (stopped) return;
    const r = gate.feed(c);
    out += r.write;
    stopped = r.stop;
  });
  return { out, stopped };
}

describe("BoundaryGate", () => {
  it("passes everything through when open", () => {
    expect(run(new BoundaryGate(), ["Every work", "shop has ", "one tool."]).out).toBe(
      "Every workshop has one tool.",
    );
  });

  it("talking over it: finishes the word it's in, then holds the rest", () => {
    const g = new BoundaryGate();
    const r = run(g, ["Every work", "shop has one", " tool."], { index: 1, mode: "word" });
    expect(r.out).toBe("Every workshop");
    expect(g.pending).toBe(" has one tool.");
    expect(g.release()).toBe(" has one tool.");
    expect(g.feed(" More.").write).toBe(" More.");
  });

  it("pausing between words holds straight away", () => {
    const g = new BoundaryGate();
    const r = run(g, ["Every workshop ", "has"], { index: 1, mode: "word" });
    expect(r.out).toBe("Every workshop ");
    expect(g.pending).toBe("has");
  });

  it("a new instruction: finishes the sentence, then stops", () => {
    const g = new BoundaryGate();
    const r = run(g, ["It hangs by the do", "or. Nobody ", "notices it."], { index: 1, mode: "sentence" });
    expect(r.out).toBe("It hangs by the door.");
    expect(r.stopped).toBe(true);
    expect(g.feed("more").write).toBe("");
  });

  it("keeps closing quotes with the sentence and ignores decimals", () => {
    const g = new BoundaryGate();
    g.set("sentence");
    expect(g.feed('He said "it costs 3.50 dollars." Then').write).toBe('He said "it costs 3.50 dollars."');
  });

  it("switching from holding to finishing the sentence writes what was held up to the sentence end", () => {
    const g = new BoundaryGate();
    g.feed("It hangs");
    g.set("word");
    g.feed(" by the door. Nobody");
    g.set("sentence");
    expect(g.feed(" notices.").write).toBe(" by the door.");
  });
});
