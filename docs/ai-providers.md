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

## Setting up a provider

Every provider is added in the same place: **Settings → AI provider → Add a provider**. Pick the
backend, fill in its fields, choose **Test connection** and then **Save provider**. Keys are kept on
your device: in the operating system's keychain in the desktop app, and encrypted in the browser's
storage on the web. They are never sent to a Vellum server.

Whichever provider you use, it bills you directly for what you use. Vellum doesn't sell or resell AI.

### Anthropic

1. Create a key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).
   Usage is billed to that Anthropic account.
2. In Vellum, choose **Anthropic**, paste the key, and test it.
3. The default model is `claude-opus-5-5`. The model picker lists everything your key can use.

Requests go straight from your browser or the desktop app to `api.anthropic.com`.

### OpenAI

1. Create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). A project key
   limited to the models you want works well.
2. In Vellum, choose **OpenAI**, paste the key, and test it. The default model is `gpt-5`.

### OpenAI-compatible endpoints

For any server that speaks the OpenAI Chat Completions API. Choose **OpenAI-compatible endpoint**, set
the **Base URL**, add a key if the service needs one, and pick a model. Some common base URLs:

| Service                  | Base URL                         | Key                          |
| ------------------------ | -------------------------------- | ---------------------------- |
| OpenRouter               | `https://openrouter.ai/api/v1`   | Your OpenRouter key          |
| Groq                     | `https://api.groq.com/openai/v1` | Your Groq key                |
| LM Studio (local)        | `http://localhost:1234/v1`       | None                         |
| vLLM (self-hosted)       | `http://your-server:8000/v1`     | Whatever `--api-key` you set |
| llama.cpp `llama-server` | `http://localhost:8080/v1`       | None unless `--api-key`      |

The endpoint has to accept requests from the page's origin (CORS). Hosted services do. For local
servers, enable CORS in LM Studio's server settings, or run vLLM with `--allowed-origins`.

### Ollama

1. Install [Ollama](https://ollama.com) and pull a model, for example `ollama pull llama3.2`.
2. In Vellum, choose **Ollama (local)**. The base URL defaults to `http://localhost:11434`; no key is
   needed.
3. Ollama accepts requests from `localhost` and from the desktop app out of the box. If you use the web
   app from another address (your own Vellum server, say), allow it before starting Ollama:
   `OLLAMA_ORIGINS=https://vellum.example.com ollama serve`.

Nothing leaves your machine, and it costs nothing to run.

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
