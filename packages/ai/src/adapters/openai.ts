import { errorFromResponse, errorFromThrown } from "../errors.js";
import { estimateTokens, sseData } from "../sse.js";
import type {
  ChatEvent,
  ChatRequest,
  ProviderAdapter,
  ProviderConfig,
  ProviderKind,
  StopReason,
} from "../types.js";

/**
 * Chat Completions adapter. Serves OpenAI itself and any OpenAI-compatible endpoint (LM Studio, vLLM,
 * OpenRouter, Groq, Together, llama.cpp server, ...) given a base URL.
 */
export function openAIAdapter(
  kind: Extract<ProviderKind, "openai" | "openai-compatible">,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): ProviderAdapter {
  const defaultBaseUrl = kind === "openai" ? "https://api.openai.com/v1" : "";

  function base(config: ProviderConfig): string {
    const url = (config.baseUrl || defaultBaseUrl).replace(/\/+$/, "");
    if (!url) throw errorFromResponse(400, { error: "A base URL is required for this provider." });
    return url;
  }

  function headers(config: ProviderConfig): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    };
  }

  async function request(config: ProviderConfig, path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${base(config)}${path}`, { ...init, headers: headers(config) });
    } catch (e) {
      throw errorFromThrown(e);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw errorFromResponse(res.status, body, res.headers);
    }
    return res;
  }

  return {
    kind,
    requiresKey: kind === "openai",
    defaultBaseUrl,

    async listModels(config, signal) {
      const res = await request(config, "/models", { method: "GET", signal });
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return (body.data ?? [])
        .map((m) => ({ id: m.id, label: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async *stream(config: ProviderConfig, req: ChatRequest): AsyncIterable<ChatEvent> {
      const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages];
      const res = await request(config, "/chat/completions", {
        method: "POST",
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
        }),
      });
      let model = req.model;
      let reason: StopReason = "end_turn";
      try {
        for await (const data of sseData(res.body!)) {
          if (data === "[DONE]") break;
          const chunk = JSON.parse(data) as {
            model?: string;
            choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          };
          if (chunk.model) model = chunk.model;
          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) yield { type: "text", text: choice.delta.content };
          if (choice?.finish_reason)
            reason =
              choice.finish_reason === "length"
                ? "max_tokens"
                : choice.finish_reason === "content_filter"
                  ? "refusal"
                  : "end_turn";
          if (chunk.usage) {
            yield {
              type: "usage",
              usage: { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens },
            };
          }
        }
      } catch (e) {
        throw errorFromThrown(e);
      }
      yield { type: "done", stopReason: reason, model };
    },

    async countTokens(_config, req) {
      const text = (req.system ?? "") + req.messages.map((m) => m.content).join("\n");
      return { tokens: estimateTokens(text) + req.messages.length * 4, exact: false };
    },
  };
}
