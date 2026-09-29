import { describe, expect, it } from "vitest";
import { VoiceTransport } from "../src/transport.js";
import type { SocketLike } from "../src/transport.js";

class FakeSocket implements SocketLike {
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | Uint8Array> = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {}
  send(d: string | ArrayBufferLike | ArrayBufferView) {
    this.sent.push(typeof d === "string" ? d : new Uint8Array(d as ArrayBuffer));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "" });
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" });
  }
}

function setup(extra: Partial<ConstructorParameters<typeof VoiceTransport>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const t = new VoiceTransport({
    url: "wss://stt.example/listen",
    protocols: ["token", "k"],
    createSocket: (u, p) => {
      const s = new FakeSocket(u, p);
      sockets.push(s);
      return s;
    },
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => undefined,
    ...extra,
  });
  return { t, sockets, timers };
}

describe("VoiceTransport", () => {
  it("queues audio while connecting, then sends the hello and the queue in order", () => {
    const { t, sockets } = setup({ hello: () => ({ type: "configure", rate: 16000 }) });
    const states: string[] = [];
    t.on("state", (s) => states.push(s));
    t.connect();
    t.sendAudio(Int16Array.of(1, 2));
    t.sendControl({ type: "mark" });
    sockets[0]!.open();
    expect(sockets[0]!.protocols).toEqual(["token", "k"]);
    expect(sockets[0]!.binaryType).toBe("arraybuffer");
    expect(sockets[0]!.sent.map((s) => (typeof s === "string" ? s : `bytes:${s.byteLength}`))).toEqual([
      '{"type":"configure","rate":16000}',
      "bytes:4",
      '{"type":"mark"}',
    ]);
    expect(states).toEqual(["connecting", "open"]);
  });

  it("parses JSON messages and passes other data through", () => {
    const { t, sockets } = setup();
    const got: unknown[] = [];
    t.on("message", (d) => got.push(d));
    t.connect();
    sockets[0]!.open();
    sockets[0]!.onmessage?.({ data: '{"type":"transcript","text":"hi"}' });
    sockets[0]!.onmessage?.({ data: "plain" });
    expect(got).toEqual([{ type: "transcript", text: "hi" }, "plain"]);
  });

  it("reconnects with backoff when the connection drops, and keeps only recent audio", () => {
    const { t, sockets, timers } = setup({ maxQueuedBytes: 8 });
    t.connect();
    sockets[0]!.open();
    sockets[0]!.drop();
    expect(t.state).toBe("reconnecting");
    expect(timers.map((x) => x.ms)).toEqual([250]);
    for (let i = 0; i < 4; i++) t.sendAudio(Int16Array.of(i, i));
    expect(t.dropped).toBe(2);
    timers[0]!.fn();
    sockets[1]!.open();
    expect(sockets[1]!.sent).toHaveLength(2);
    sockets[1]!.drop();
    expect(timers.at(-1)!.ms).toBe(250);
  });

  it("gives up after the maximum attempts", () => {
    const { t, sockets, timers } = setup({ maxAttempts: 2 });
    t.connect();
    sockets[0]!.drop();
    timers[0]!.fn();
    sockets[1]!.drop();
    timers[1]!.fn();
    sockets[2]!.drop();
    expect(timers.map((x) => x.ms)).toEqual([250, 500]);
    expect(t.state).toBe("closed");
  });

  it("closes cleanly with a final message and doesn't reconnect", () => {
    const { t, sockets, timers } = setup({ keepAlive: { everyMs: 5000, message: { type: "KeepAlive" } } });
    t.connect();
    sockets[0]!.open();
    timers[0]!.fn();
    expect(sockets[0]!.sent).toEqual(['{"type":"KeepAlive"}']);
    t.close({ type: "CloseStream" });
    expect(sockets[0]!.sent.at(-1)).toBe('{"type":"CloseStream"}');
    expect(t.state).toBe("closed");
    t.sendAudio(Int16Array.of(1));
    expect(sockets).toHaveLength(1);
  });
});
