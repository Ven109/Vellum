import { describe, expect, it } from "vitest";
import { ProviderError, complete, createRegistry, resolveModel, testConnection } from "../src/index.js";
import type { ProviderConfig } from "../src/index.js";

type Call = { url: string; init: RequestInit };

function sse(events: Array<[string | null, unknown]>): string {
  return events
    .map(
      ([ev, data]) =>
        `${ev ? `event: ${ev}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
    )
    .join("");
}

function mockFetch(handler: (url: string, init: RequestInit) => Response): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const req = input instanceof Request ? input : null;
    const merged: RequestInit = {
      ...init,
      headers: init?.headers ?? req?.headers,
      body: init?.body ?? (req ? await req.text() : undefined),
    };
    calls.push({ url, init: merged });
    return handler(url, merged);
  }) as typeof fetch;
  return { fetch: f, calls };
}

function streamResponse(body: string, contentType = "text/event-stream"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers as HeadersInit).get(name);
}

const anthropicCfg: ProviderConfig = {
  id: "anthropic",
  kind: "anthropic",
  label: "Anthropic",
  apiKey: "sk-ant-test",
  defaultModel: "claude-opus-5-5",
};

describe("anthropic adapter", () => {
  it("streams text and usage and sends the key only to the provider", async () => {
    const { fetch, calls } = mockFetch(() =>
      streamResponse(
        sse([
          [
            "message_start",
            {
              type: "message_start",
              message: {
                id: "m1",
                type: "message",
                role: "assistant",
                model: "claude-opus-5-5",
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 12, output_tokens: 1 },
              },
            },
          ],
          [
            "content_block_start",
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          ],
          [
            "content_block_delta",
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
          ],
          [
            "content_block_delta",
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } },
          ],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          [
            "message_delta",
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 5 },
            },
          ],
          ["message_stop", { type: "message_stop" }],
        ]),
      ),
    );
    const adapter = createRegistry(fetch).anthropic;
    const chunks: string[] = [];
    const result = await complete(
      adapter,
      anthropicCfg,
      { model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }] },
      (t) => chunks.push(t),
    );
    expect(chunks).toEqual(["Hello", " there"]);
    expect(result).toMatchObject({
      text: "Hello there",
      usage: { inputTokens: 12, outputTokens: 5 },
      stopReason: "end_turn",
      model: "claude-opus-5-5",
    });
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(header(calls[0]!.init, "x-api-key")).toBe("sk-ant-test");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.temperature).toBeUndefined();
  });

  it("normalises an invalid key", async () => {
    const { fetch } = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "authentication_error", message: "invalid x-api-key" },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const err = await testConnection(createRegistry(fetch).anthropic, anthropicCfg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("invalid_key");
    expect((err as ProviderError).retryable).toBe(false);
  });

  it("normalises rate limits with retry-after", async () => {
    const { fetch } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }),
          { status: 429, headers: { "content-type": "application/json", "retry-after": "7" } },
        ),
    );
    const err = (await testConnection(createRegistry(fetch).anthropic, anthropicCfg).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.code).toBe("rate_limited");
    expect(err.retryable).toBe(true);
    expect(err.opts.retryAfterMs).toBe(7000);
  });

  it("lists models and counts tokens", async () => {
    const { fetch } = mockFetch((url) => {
      if (url.includes("/v1/models"))
        return Response.json({
          data: [
            {
              id: "claude-opus-5-5",
              display_name: "Claude Opus 5.5",
              type: "model",
              created_at: "2026-01-01T00:00:00Z",
              max_input_tokens: 1000000,
            },
          ],
          has_more: false,
          first_id: "claude-opus-5-5",
          last_id: "claude-opus-5-5",
        });
      return Response.json({ input_tokens: 42 });
    });
    const adapter = createRegistry(fetch).anthropic;
    expect(await adapter.listModels(anthropicCfg)).toEqual([
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", contextWindow: 1000000 },
    ]);
    expect(
      await adapter.countTokens(anthropicCfg, {
        model: "claude-opus-5-5",
        messages: [{ role: "user", content: "x" }],
      }),
    ).toEqual({ tokens: 42, exact: true });
  });
});

describe("openai adapters", () => {
  const cfg: ProviderConfig = {
    id: "openai",
    kind: "openai",
    label: "OpenAI",
    apiKey: "sk-test",
    defaultModel: "gpt-5",
  };

  it("streams chat completions with usage", async () => {
    const { fetch, calls } = mockFetch(() =>
      streamResponse(
        sse([
          [null, { model: "gpt-5", choices: [{ delta: { content: "Hi" } }] }],
          [null, { model: "gpt-5", choices: [{ delta: { content: "!" }, finish_reason: "stop" }] }],
          [null, { model: "gpt-5", choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } }],
          [null, "[DONE]"],
        ]),
      ),
    );
    const result = await complete(createRegistry(fetch).openai, cfg, {
      model: "gpt-5",
      system: "Be brief",
      messages: [{ role: "user", content: "hey" }],
    });
    expect(result).toMatchObject({
      text: "Hi!",
      usage: { inputTokens: 9, outputTokens: 2 },
      stopReason: "end_turn",
    });
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(header(calls[0]!.init, "authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(calls[0]!.init.body)).messages[0]).toEqual({
      role: "system",
      content: "Be brief",
    });
  });

  it("uses a custom base URL without a key for compatible endpoints", async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ data: [{ id: "b-model" }, { id: "a-model" }] }));
    const models = await createRegistry(fetch)["openai-compatible"].listModels({
      id: "x",
      kind: "openai-compatible",
      label: "LM Studio",
      baseUrl: "http://localhost:1234/v1/",
      defaultModel: "a",
    });
    expect(models.map((m) => m.id)).toEqual(["a-model", "b-model"]);
    expect(calls[0]!.url).toBe("http://localhost:1234/v1/models");
    expect(header(calls[0]!.init, "authorization")).toBeNull();
  });

  it("maps quota errors", async () => {
    const { fetch } = mockFetch(() =>
      Response.json(
        { error: { code: "insufficient_quota", message: "You exceeded your current quota" } },
        { status: 429 },
      ),
    );
    const err = (await testConnection(createRegistry(fetch).openai, cfg).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.code).toBe("quota_exceeded");
  });

  it("maps network failures", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = (await testConnection(createRegistry(failing).openai, cfg).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.code).toBe("network");
  });
});

describe("ollama adapter", () => {
  it("streams NDJSON", async () => {
    const lines = [
      { model: "llama3.2", message: { content: "Local " } },
      { model: "llama3.2", message: { content: "reply" } },
      { model: "llama3.2", done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 3 },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n");
    const { fetch, calls } = mockFetch(() => streamResponse(lines, "application/x-ndjson"));
    const result = await complete(
      createRegistry(fetch).ollama,
      { id: "o", kind: "ollama", label: "Ollama", defaultModel: "llama3.2" },
      { model: "llama3.2", messages: [{ role: "user", content: "hi" }] },
    );
    expect(result).toMatchObject({ text: "Local reply", usage: { inputTokens: 5, outputTokens: 3 } });
    expect(calls[0]!.url).toBe("http://localhost:11434/api/chat");
  });
});

describe("resolveModel", () => {
  const providers: ProviderConfig[] = [
    { id: "a", kind: "anthropic", label: "A", defaultModel: "claude-opus-5-5" },
    { id: "o", kind: "ollama", label: "O", defaultModel: "llama3.2" },
  ];
  it("prefers the document override, then the workspace default, then the first provider", () => {
    expect(
      resolveModel(
        providers,
        { providerId: "a", model: "claude-sonnet-5-5" },
        { providerId: "o", model: "qwen" },
      ),
    ).toMatchObject({ provider: { id: "o" }, model: "qwen" });
    expect(resolveModel(providers, { providerId: "a", model: "claude-sonnet-5-5" })).toMatchObject({
      provider: { id: "a" },
      model: "claude-sonnet-5-5",
    });
    expect(resolveModel(providers, { providerId: "gone", model: "x" })).toMatchObject({
      provider: { id: "a" },
      model: "claude-opus-5-5",
    });
    expect(resolveModel([])).toBeNull();
  });
});
