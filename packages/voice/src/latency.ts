/**
 * The reaction budget: from the moment you stop speaking to the moment the agent visibly reacts.
 * Measured on every turn and kept as a budget, not an aspiration.
 */
export const REACTION_BUDGET_MS = 300;

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
  budgetMs: number;
  withinBudget: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

export class LatencyMeter {
  private samples: number[] = [];
  constructor(
    readonly budgetMs: number = REACTION_BUDGET_MS,
    readonly keep = 200,
  ) {}

  record(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get last(): number | null {
    return this.samples.at(-1) ?? null;
  }

  summary(): LatencySummary {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = Math.round(percentile(sorted, 95));
    return {
      count: sorted.length,
      p50: Math.round(percentile(sorted, 50)),
      p95,
      max: Math.round(sorted.at(-1) ?? 0),
      budgetMs: this.budgetMs,
      // The budget holds for the 95th percentile, not just the typical turn.
      withinBudget: sorted.length > 0 && p95 <= this.budgetMs,
    };
  }
}
