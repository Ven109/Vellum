import { describe, expect, it, vi } from "vitest";
import { SpeechError, createRecognizer, createSynthesizer, STT_PRESETS, TTS_PRESETS } from "../src/index.js";
import type { SocketLike } from "../src/index.js";

const frame = (v = 1000) => new Int16Array(320).fill(v);

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("speech-to-text", () => {
  it("sends a whole turn to OpenAI as WAV, with pre-roll, and returns the text", async () => {
    const { f, calls } = fakeFetch(() => Response.json({ text: " Every workshop has one tool. " }));
    const r = createRecognizer({ kind: "openai", apiKey: "sk-x" }, {}, { fetch: f });
    for (let i = 0; i < 20; i++) r.push(frame(1), false); // silence before
    for (let i = 0; i < 50; i++) r.push(frame(), true); // one second of speech
    expect(await r.endTurn()).toBe("Every workshop has one tool.");
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-x");
    const form = calls[0]!.init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    const wav = form.get("file") as Blob;
    // 44-byte header + (15 pre-roll + 50) frames × 320 samples × 2 bytes.
    expect(wav.size).toBe(44 + 65 * 640);
    expect(await r.endTurn()).toBe("");
  });

  it("uses a local whisper.cpp server without a key", async () => {
    const { f, calls } = fakeFetch(() => Response.json({ text: "hello" }));
    const r = createRecognizer({ kind: "whisper-cpp", baseUrl: "http://127.0.0.1:8080/" }, {}, { fetch: f });
    r.push(frame(), true);
    expect(await r.endTurn()).toBe("hello");
    expect(calls[0]!.url).toBe("http://127.0.0.1:8080/inference");
    expect(calls[0]!.init.headers).toEqual({});
  });

  it("explains provider errors", async () => {
    const onError = vi.fn();
    const { f } = fakeFetch(() => Response.json({ error: { message: "bad key" } }, { status: 401 }));
    const r = createRecognizer({ kind: "openai", apiKey: "sk-bad" }, { onError }, { fetch: f });
    r.push(frame(), true);
    await expect(r.endTurn()).rejects.toMatchObject({ code: "invalid_key" });
    expect(onError).toHaveBeenCalled();
    const offline = createRecognizer(
      { kind: "openai", apiKey: "k" },
      {},
      {
        fetch: (async () => {
          throw new TypeError("Failed to fetch");
        }) as unknown as typeof fetch,
      },
    );
    offline.push(frame(), true);
    await expect(offline.endTurn()).rejects.toMatchObject({ code: "network" });
    expect(() => createRecognizer({ kind: "openai" })).toThrow(SpeechError);
  });

  it("streams to Deepgram with the key as a subprotocol, shows interim words and finalizes a turn", async () => {
    const sockets: Array<SocketLike & { sent: unknown[]; url: string; protocols: unknown }> = [];
    const createSocket = (url: string, protocols?: string | string[]) => {
      const s = {
        url,
        protocols,
        readyState: 0,
        binaryType: "blob",
        sent: [] as unknown[],
        send(d: unknown) {
          this.sent.push(d);
        },
        close() {
          this.readyState = 3;
        },
        onopen: null as ((e: unknown) => void) | null,
        onclose: null,
        onerror: null,
        onmessage: null as ((e: { data: unknown }) => void) | null,
      };
      sockets.push(s as never);
      return s as unknown as SocketLike;
    };
    const interim: string[] = [];
    const r = createRecognizer(
      { kind: "deepgram", apiKey: "dg-key", language: "en" },
      { onInterim: (t) => interim.push(t) },
      { createSocket },
    );
    const s = sockets[0]!;
    expect(s.url).toContain("wss://api.deepgram.com/v1/listen?");
    expect(s.url).toContain("encoding=linear16");
    expect(s.url).toContain("sample_rate=16000");
    expect(s.url).toContain("language=en");
    expect(s.protocols).toEqual(["token", "dg-key"]);
    (s as { readyState: number }).readyState = 1;
    s.onopen!({});
    r.push(frame(1), false);
    expect(s.sent).toHaveLength(0); // silence isn't sent
    r.push(frame(), true);
    expect(s.sent).toHaveLength(2); // pre-roll + frame
    const msg = (o: unknown) => s.onmessage!({ data: JSON.stringify(o) });
    const result = (text: string, extra: object) =>
      msg({ type: "Results", channel: { alternatives: [{ transcript: text }] }, ...extra });
    result("every work", { is_final: false });
    result("every workshop has", { is_final: true });
    const done = r.endTurn();
    expect(s.sent.at(-1)).toBe('{"type":"Finalize"}');
    result("one tool", { is_final: true, from_finalize: true });
    expect(await done).toBe("every workshop has one tool");
    expect(interim).toEqual(["every work", "every workshop has", "every workshop has one tool"]);
    r.close();
    expect(s.sent.at(-1)).toBe('{"type":"CloseStream"}');
  });

  it("offers a local option", () => {
    expect(STT_PRESETS.filter((p) => p.local).map((p) => p.kind)).toEqual(["whisper-cpp"]);
  });
});

describe("text-to-speech", () => {
  it("asks OpenAI for speech in the chosen voice", async () => {
    const { f, calls } = fakeFetch(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
    );
    const s = createSynthesizer({ kind: "openai", apiKey: "sk-x", voice: "nova" }, { fetch: f });
    const res = await s.synthesize("Hello there");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "nova",
      input: "Hello there",
      response_format: "mp3",
    });
    expect((await s.listVoices()).map((v) => v.id)).toContain("coral");
  });

  it("lists ElevenLabs voices (with previews) and streams speech", async () => {
    const { f, calls } = fakeFetch((url) =>
      url.endsWith("/voices")
        ? Response.json({
            voices: [
              {
                voice_id: "v1",
                name: "Rachel",
                preview_url: "https://x/p.mp3",
                labels: { accent: "american" },
              },
              { voice_id: "v2", name: "Me", category: "cloned" },
            ],
          })
        : new Response(new Uint8Array([9])),
    );
    const s = createSynthesizer({ kind: "elevenlabs", apiKey: "el", voice: "v2" }, { fetch: f });
    expect(await s.listVoices()).toEqual([
      { id: "v1", name: "Rachel", description: "american", previewUrl: "https://x/p.mp3" },
      { id: "v2", name: "Me", description: "your voice" },
    ]);
    await s.synthesize("Hi");
    expect(calls[1]!.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/v2/stream?output_format=mp3_44100_128",
    );
    expect((calls[1]!.init.headers as Record<string, string>)["xi-api-key"]).toBe("el");
  });

  it("maps quota errors and refuses the system voice (played by the page)", async () => {
    const { f } = fakeFetch(() => Response.json({ detail: { status: "quota_exceeded" } }, { status: 402 }));
    await expect(
      createSynthesizer({ kind: "elevenlabs", apiKey: "k" }, { fetch: f }).synthesize("x"),
    ).rejects.toMatchObject({
      code: "quota_exceeded",
    });
    expect(() => createSynthesizer({ kind: "system" })).toThrow(SpeechError);
    expect(TTS_PRESETS[0]!.kind).toBe("system");
  });
});
