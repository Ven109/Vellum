import { errorFromResponse, errorFromThrown } from "../errors.js";
import { estimateTokens, ndjson } from "../sse.js";
import type { ChatEvent, ChatRequest, ProviderAdapter, ProviderConfig } from "../types.js";

/** Ollama (or any runtime exposing Ollama's API) on the user's machine or network. No key needed. */
export function ollamaAdapter(fetchImpl: typeof fetch = (...a) => fetch(...a)): ProviderAdapter {
  const defaultBaseUrl = "http://localhost:11434";
  const base = (c: ProviderConfig) => (c.baseUrl || defaultBaseUrl).replace(/\/+$/, "");

  async function request(config: ProviderConfig, path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${base(config)}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
      });
    } catch (e) {
      throw errorFromThrown(e);
    }
    if (!res.ok) throw errorFromResponse(res.status, await res.json().catch(() => null), res.headers);
    return res;
  }

  return {
    kind: "ollama",
    requiresKey: false,
    defaultBaseUrl,

    async listModels(config, signal) {
      const res = await request(config, "/api/tags", { method: "GET", signal });
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      return (body.models ?? []).map((m) => ({ id: m.name, label: m.name }));
    },

    async *stream(config: ProviderConfig, req: ChatRequest): AsyncIterable<ChatEvent> {
      const res = await request(config, "/api/chat", {
        method: "POST",
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          stream: true,
          messages: [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages],
          ...(req.maxTokens ? { options: { num_predict: req.maxTokens } } : {}),
        }),
      });
      let model = req.model;
      try {
        for await (const raw of ndjson(res.body!)) {
          const line = raw as {
            model?: string;
            message?: { content?: string };
            done?: boolean;
            done_reason?: string;
            prompt_eval_count?: number;
            eval_count?: number;
            error?: string;
          };
          if (line.error) throw errorFromResponse(500, { error: line.error });
          if (line.model) model = line.model;
          if (line.message?.content) yield { type: "text", text: line.message.content };
          if (line.done) {
            yield {
              type: "usage",
              usage: { inputTokens: line.prompt_eval_count ?? 0, outputTokens: line.eval_count ?? 0 },
            };
            yield {
              type: "done",
              stopReason: line.done_reason === "length" ? "max_tokens" : "end_turn",
              model,
            };
            return;
          }
        }
      } catch (e) {
        throw errorFromThrown(e);
      }
      yield { type: "done", stopReason: "end_turn", model };
    },

    async countTokens(_config, req) {
      return {
        tokens: estimateTokens((req.system ?? "") + req.messages.map((m) => m.content).join("\n")),
        exact: false,
      };
    },
  };
}
