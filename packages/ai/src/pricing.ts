import type { ProviderKind, Usage } from "./types.js";

/**
 * Published list prices in USD per million tokens. Users pay their provider directly, so these are
 * estimates to help them see what they are spending; the provider's bill is authoritative. Unknown
 * models show token counts only, and a custom price can be set per model in settings.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const KNOWN_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

export function priceFor(
  kind: ProviderKind,
  model: string,
  overrides: Record<string, ModelPrice> = {},
): ModelPrice | null {
  if (overrides[model]) return overrides[model];
  if (kind === "ollama") return { inputPerMTok: 0, outputPerMTok: 0 };
  // Tolerate dated snapshots and aliases like "claude-opus-5-5-latest".
  const key = Object.keys(KNOWN_PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  return key ? KNOWN_PRICES[key]! : null;
}

export function costUsd(usage: Usage, price: ModelPrice | null): number | null {
  if (!price) return null;
  return (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
}

export function formatUsd(amount: number | null): string {
  if (amount === null) return "—";
  if (amount === 0) return "$0";
  if (amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(amount < 1 ? 3 : 2)}`;
}

export function formatTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString("en-US");
}
