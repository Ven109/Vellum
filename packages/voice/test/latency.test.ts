import { describe, expect, it } from "vitest";
import { LatencyMeter, REACTION_BUDGET_MS } from "../src/latency.js";

describe("LatencyMeter", () => {
  it("holds the budget to the 95th percentile", () => {
    const m = new LatencyMeter();
    for (let i = 0; i < 19; i++) m.record(200);
    m.record(290);
    expect(m.summary()).toMatchObject({ count: 20, p50: 200, p95: 200, max: 290, withinBudget: true });
    m.record(900);
    m.record(950);
    expect(m.summary().withinBudget).toBe(false);
    expect(REACTION_BUDGET_MS).toBe(300);
  });

  it("ignores nonsense and has no verdict without samples", () => {
    const m = new LatencyMeter();
    m.record(-5);
    m.record(Number.NaN);
    expect(m.summary()).toMatchObject({ count: 0, withinBudget: false });
    expect(m.last).toBeNull();
  });
});
