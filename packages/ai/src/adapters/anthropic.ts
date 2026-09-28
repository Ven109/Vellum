import Anthropic from "@anthropic-ai/sdk";
import { errorFromResponse, errorFromThrown } from "../errors.js";
import { ProviderError } from "../types.js";
import type {
  ChatEvent,
  ChatRequest,
  ModelInfo,
  ProviderAdapter,
  ProviderConfig,
  StopReason,
} from "../types.js";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

function client(config: ProviderConfig, fetchImpl?: typeof fetch): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey ?? "",
    baseURL: config.baseUrl || undefined,
    // Requests go straight from the user's browser to Anthropic with the user's own key; nothing is
    // proxied through Vellum. The key never leaves the device except to api.anthropic.com.
    dangerouslyAllowBrowser: true,
    // Retries are driven by the UI so the user sees what is happening.
    maxRetries: 0,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

function normalise(e: unknown): ProviderError {
  if (e instanceof Anthropic.APIUserAbortError)
    return errorFromThrown(Object.assign(new Error("aborted"), { name: "AbortError" }));
  if (e instanceof Anthropic.APIConnectionError) return errorFromThrown(e);
  if (e instanceof Anthropic.APIError && typeof e.status === "number") {
    return errorFromResponse(e.status, e.error, e.headers as Headers | undefined);
  }
  return errorFromThrown(e);
}

function stopReason(r: string | null | undefined): StopReason {
  if (r === "end_turn" || r === "stop_sequence") return "end_turn";
  if (r === "max_tokens") return "max_tokens";
  if (r === "refusal") return "refusal";
  return r ? "unknown" : "end_turn";
}

export function anthropicAdapter(fetchImpl?: typeof fetch): ProviderAdapter {
  return {
    kind: "anthropic",
    requiresKey: true,
    defaultBaseUrl: "https://api.anthropic.com",

    async listModels(config, signal) {
      try {
        const out: ModelInfo[] = [];
        for await (const m of client(config, fetchImpl).models.list({}, { signal })) {
          out.push({
            id: m.id,
            label: m.display_name,
            contextWindow: (m as { max_input_tokens?: number }).max_input_tokens,
          });
        }
        return out;
      } catch (e) {
        throw normalise(e);
      }
    },

    async *stream(config: ProviderConfig, req: ChatRequest): AsyncIterable<ChatEvent> {
      let model = req.model;
      let reason: StopReason = "end_turn";
      try {
        const stream = client(config, fetchImpl).messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens ?? 16000,
            ...(req.system ? { system: req.system } : {}),
            messages: req.messages,
          },
          { signal: req.signal },
        );
        for await (const event of stream) {
          if (event.type === "message_start") {
            model = event.message.model;
            yield { type: "usage", usage: { inputTokens: event.message.usage.input_tokens } };
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          } else if (event.type === "message_delta") {
            reason = stopReason(event.delta.stop_reason);
            yield { type: "usage", usage: { outputTokens: event.usage.output_tokens } };
          }
        }
      } catch (e) {
        throw normalise(e);
      }
      if (reason === "refusal") throw new ProviderError("refused", "The model declined this request.");
      yield { type: "done", stopReason: reason, model };
    },

    async countTokens(config, req) {
      try {
        const res = await client(config, fetchImpl).messages.countTokens({
          model: req.model,
          ...(req.system ? { system: req.system } : {}),
          messages: req.messages,
        });
        return { tokens: res.input_tokens, exact: true };
      } catch (e) {
        throw normalise(e);
      }
    },
  };
}
