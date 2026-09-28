import { costUsd, priceFor } from "@vellum/ai";
import type { ModelPrice, ProviderKind, Usage } from "@vellum/ai";
import { openDB } from "idb";
import { create } from "zustand";

/**
 * A local ledger of assistant requests: tokens, model and estimated cost. It never leaves this device.
 * The provider's own bill is authoritative; this is so writers can see what they are spending.
 */
export interface UsageEntry {
  id?: number;
  at: string;
  month: string;
  providerId: string;
  kind: ProviderKind;
  model: string;
  feature: "chat" | "rewrite" | "voice" | "test";
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

function db() {
  return openDB("vellum-usage", 1, {
    upgrade(d) {
      d.createObjectStore("entries", { keyPath: "id", autoIncrement: true }).createIndex("byMonth", "month");
    },
  });
}

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export interface Totals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** True when some requests had no known price, so costUsd is a lower bound. */
  partialCost: boolean;
}

export const emptyTotals = (): Totals => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  partialCost: false,
});

export function addTo(t: Totals, e: Pick<UsageEntry, "inputTokens" | "outputTokens" | "costUsd">): Totals {
  return {
    requests: t.requests + 1,
    inputTokens: t.inputTokens + e.inputTokens,
    outputTokens: t.outputTokens + e.outputTokens,
    costUsd: t.costUsd + (e.costUsd ?? 0),
    partialCost: t.partialCost || (e.costUsd === null && e.inputTokens + e.outputTokens > 0),
  };
}

interface UsageState {
  session: Totals;
  month: Totals;
  byModel: Record<string, Totals>;
  priceOverrides: Record<string, ModelPrice>;
  load(): Promise<void>;
  record(e: Omit<UsageEntry, "at" | "month" | "costUsd">): Promise<UsageEntry>;
}

export const useUsage = create<UsageState>((set, get) => ({
  session: emptyTotals(),
  month: emptyTotals(),
  byModel: {},
  priceOverrides: {},
  async load() {
    const entries = await (await db()).getAllFromIndex("entries", "byMonth", monthKey());
    let month = emptyTotals();
    const byModel: Record<string, Totals> = {};
    for (const e of entries) {
      month = addTo(month, e);
      byModel[e.model] = addTo(byModel[e.model] ?? emptyTotals(), e);
    }
    set({ month, byModel });
  },
  async record(e) {
    const usage: Usage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens };
    const entry: UsageEntry = {
      ...e,
      at: new Date().toISOString(),
      month: monthKey(),
      costUsd: costUsd(usage, priceFor(e.kind, e.model, get().priceOverrides)),
    };
    await (await db()).add("entries", entry);
    set({
      session: addTo(get().session, entry),
      month: addTo(get().month, entry),
      byModel: { ...get().byModel, [entry.model]: addTo(get().byModel[entry.model] ?? emptyTotals(), entry) },
    });
    return entry;
  },
}));
