import { ANTHROPIC_DEFAULT_MODEL, anthropicAdapter } from "./adapters/anthropic.js";
import { ollamaAdapter } from "./adapters/ollama.js";
import { openAIAdapter } from "./adapters/openai.js";
import { errorFromThrown } from "./errors.js";
import type {
  ChatRequest,
  ChatResult,
  ProviderAdapter,
  ProviderConfig,
  ProviderKind,
  Usage,
} from "./types.js";

export interface ProviderPreset {
  kind: ProviderKind;
  label: string;
  description: string;
  defaultModel: string;
  keyUrl?: string;
  needsBaseUrl: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    kind: "anthropic",
    label: "Anthropic",
    description: "Claude models, called directly with your Anthropic API key.",
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    keyUrl: "https://console.anthropic.com/settings/keys",
    needsBaseUrl: false,
  },
  {
    kind: "openai",
    label: "OpenAI",
    description: "OpenAI models, called directly with your OpenAI API key.",
    defaultModel: "gpt-5",
    keyUrl: "https://platform.openai.com/api-keys",
    needsBaseUrl: false,
  },
  {
    kind: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    description: "Any server that speaks the OpenAI Chat Completions API (LM Studio, vLLM, OpenRouter, …).",
    defaultModel: "",
    needsBaseUrl: true,
  },
  {
    kind: "ollama",
    label: "Ollama (local)",
    description: "Models running on your own machine. Nothing leaves your network; no key needed.",
    defaultModel: "llama3.2",
    needsBaseUrl: true,
  },
];

/** Adapter lookup. `fetchImpl` is injectable so tests (and the desktop app) can supply their own. */
export function createRegistry(fetchImpl?: typeof fetch): Record<ProviderKind, ProviderAdapter> {
  return {
    anthropic: anthropicAdapter(fetchImpl),
    openai: openAIAdapter("openai", fetchImpl),
    "openai-compatible": openAIAdapter("openai-compatible", fetchImpl),
    ollama: ollamaAdapter(fetchImpl),
  };
}

let defaultRegistry: Record<ProviderKind, ProviderAdapter> | null = null;

export function adapterFor(kind: ProviderKind): ProviderAdapter {
  defaultRegistry ??= createRegistry();
  return defaultRegistry[kind];
}

/** Run a streaming request to completion, calling `onText` for each chunk. */
export async function complete(
  adapter: ProviderAdapter,
  config: ProviderConfig,
  req: ChatRequest,
  onText?: (text: string, soFar: string) => void,
): Promise<ChatResult> {
  let text = "";
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let result: ChatResult | null = null;
  try {
    for await (const ev of adapter.stream(config, req)) {
      if (ev.type === "text") {
        text += ev.text;
        onText?.(ev.text, text);
      } else if (ev.type === "usage") {
        if (ev.usage.inputTokens !== undefined) usage.inputTokens = ev.usage.inputTokens;
        if (ev.usage.outputTokens !== undefined) usage.outputTokens = ev.usage.outputTokens;
      } else {
        result = { text, usage, stopReason: ev.stopReason, model: ev.model };
      }
    }
  } catch (e) {
    throw errorFromThrown(e);
  }
  return result ?? { text, usage, stopReason: "end_turn", model: req.model };
}

/** Make one tiny real call to prove the key, endpoint and model work. */
export async function testConnection(
  adapter: ProviderAdapter,
  config: ProviderConfig,
  signal?: AbortSignal,
): Promise<ChatResult> {
  return complete(adapter, config, {
    model: config.defaultModel,
    maxTokens: 16,
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
    signal,
  });
}

export interface ModelSelection {
  providerId: string;
  model: string;
}

/**
 * Which provider and model to use for a document: the document's override if it has one and that
 * provider is still configured, else the workspace default, else the first configured provider.
 */
export function resolveModel(
  providers: ProviderConfig[],
  workspaceDefault?: ModelSelection,
  documentOverride?: ModelSelection,
): { provider: ProviderConfig; model: string } | null {
  for (const choice of [documentOverride, workspaceDefault]) {
    if (!choice) continue;
    const provider = providers.find((p) => p.id === choice.providerId);
    if (provider) return { provider, model: choice.model || provider.defaultModel };
  }
  const first = providers[0];
  return first ? { provider: first, model: first.defaultModel } : null;
}
