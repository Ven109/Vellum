# AI providers

Vellum's assistant is **bring your own key**. There is no hosted inference and no fallback key: without a
configured provider the assistant is simply off, and the rest of Vellum works normally.

## Supported backends

| Provider                   | Adapter             | Key      | Notes                                                                                                          |
| -------------------------- | ------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| Anthropic                  | `anthropic`         | Required | Uses the official `@anthropic-ai/sdk`. Default model `claude-opus-5-5`. Exact token counts via `count_tokens`. |
| OpenAI                     | `openai`            | Required | Chat Completions with streamed usage.                                                                          |
| OpenAI-compatible endpoint | `openai-compatible` | Optional | Any base URL speaking Chat Completions: LM Studio, vLLM, llama.cpp server, OpenRouter, Groq, …                 |
| Ollama                     | `ollama`            | None     | Local models; default `http://localhost:11434`.                                                                |

## The abstraction

`packages/ai` defines one interface, `ProviderAdapter`:

- `stream(config, request)` yields `text`, `usage` and `done` events;
- `listModels(config)` for the model picker;
- `countTokens(config, request)` — exact when the provider has an endpoint, estimated otherwise (the
  result says which);
- errors are normalised to `ProviderError` with a `code` (`invalid_key`, `rate_limited`,
  `quota_exceeded`, `model_not_found`, `context_too_long`, `overloaded`, `server`, `network`,
  `aborted`, `refused`, …), a human message, `retryable`, and `retryAfterMs` when the provider sent one.

Adding a backend is a new file in `packages/ai/src/adapters/` plus an entry in `createRegistry()` and
`PROVIDER_PRESETS` — nothing else in the app changes.

## Choosing a model

`resolveModel(providers, workspaceDefault, documentOverride)` picks the document's override if it has
one and that provider is still configured, else the workspace default, else the first configured
provider.
