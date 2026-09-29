/** The subset of the browser WebSocket the transport needs (so tests can supply a fake). */
export interface SocketLike {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string, protocols?: string | string[]) => SocketLike;

export type TransportState = "connecting" | "open" | "reconnecting" | "closed";

export interface TransportOptions {
  url: string;
  protocols?: string | string[];
  /** Audio kept while (re)connecting; older frames are dropped so a stall never replays stale speech. */
  maxQueuedBytes?: number;
  /** Reconnect delays: base × 2^attempt, capped. */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  maxAttempts?: number;
  /** A JSON message sent every so often to keep idle connections (and proxies) open. */
  keepAlive?: { everyMs: number; message: unknown };
  /** Sent first on every (re)connect, e.g. the provider's session configuration. */
  hello?: () => unknown;
  createSocket?: SocketFactory;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const OPEN = 1;

/**
 * One persistent connection for a voice session: binary audio frames up, JSON (or text) events down.
 * Queues audio while connecting, reconnects with backoff when the network drops, and closes cleanly.
 */
export class VoiceTransport {
  private socket: SocketLike | null = null;
  private queue: Array<string | Uint8Array> = [];
  private queuedBytes = 0;
  private attempts = 0;
  private timer: unknown = null;
  private keepAliveTimer: unknown = null;
  private closedByUs = false;
  private listeners = {
    message: new Set<(data: unknown) => void>(),
    state: new Set<(s: TransportState) => void>(),
  };
  state: TransportState = "closed";
  dropped = 0;

  constructor(private readonly o: TransportOptions) {}

  private get create(): SocketFactory {
    return this.o.createSocket ?? ((url, p) => new WebSocket(url, p) as unknown as SocketLike);
  }
  private setTimer(fn: () => void, ms: number) {
    return (this.o.setTimer ?? ((f: () => void, m: number) => setTimeout(f, m)))(fn, ms);
  }
  private clearTimer(t: unknown) {
    if (t !== null)
      (this.o.clearTimer ?? ((x: unknown) => clearTimeout(x as ReturnType<typeof setTimeout>)))(t);
  }

  on(event: "message", fn: (data: unknown) => void): () => void;
  on(event: "state", fn: (s: TransportState) => void): () => void;
  on(event: "message" | "state", fn: (v: never) => void) {
    const set = this.listeners[event] as Set<typeof fn>;
    set.add(fn);
    return () => set.delete(fn);
  }

  private setState(s: TransportState) {
    this.state = s;
    for (const fn of this.listeners.state) fn(s);
  }

  connect() {
    this.closedByUs = false;
    this.open(false);
  }

  private open(reconnecting: boolean) {
    this.setState(reconnecting ? "reconnecting" : "connecting");
    const ws = this.create(this.o.url, this.o.protocols);
    ws.binaryType = "arraybuffer";
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.attempts = 0;
      this.setState("open");
      const hello = this.o.hello?.();
      if (hello !== undefined) ws.send(typeof hello === "string" ? hello : JSON.stringify(hello));
      this.flush();
      this.startKeepAlive();
    };
    ws.onmessage = (ev) => {
      if (this.socket !== ws) return;
      let data = ev.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          /* plain text */
        }
      }
      for (const fn of this.listeners.message) fn(data);
    };
    ws.onerror = () => undefined;
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.stopKeepAlive();
      this.socket = null;
      if (this.closedByUs) return this.setState("closed");
      const max = this.o.maxAttempts ?? 6;
      if (this.attempts >= max) return this.setState("closed");
      const delay = Math.min(
        (this.o.reconnectBaseMs ?? 250) * 2 ** this.attempts,
        this.o.reconnectMaxMs ?? 5000,
      );
      this.attempts++;
      this.setState("reconnecting");
      this.timer = this.setTimer(() => {
        this.timer = null;
        if (!this.closedByUs) this.open(true);
      }, delay);
    };
  }

  private startKeepAlive() {
    const k = this.o.keepAlive;
    if (!k) return;
    const tick = () => {
      this.keepAliveTimer = this.setTimer(() => {
        if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(k.message));
        tick();
      }, k.everyMs);
    };
    tick();
  }

  private stopKeepAlive() {
    this.clearTimer(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  private flush() {
    const ws = this.socket;
    if (!ws || ws.readyState !== OPEN) return;
    for (const item of this.queue) ws.send(item);
    this.queue = [];
    this.queuedBytes = 0;
  }

  /** Send a binary audio frame (queued while connecting). */
  sendAudio(frame: Uint8Array | Int16Array) {
    const bytes =
      frame instanceof Uint8Array ? frame : new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
    if (this.socket?.readyState === OPEN) return this.socket.send(bytes);
    if (this.closedByUs) return;
    this.queue.push(bytes);
    this.queuedBytes += bytes.byteLength;
    const max = this.o.maxQueuedBytes ?? 16_000 * 2 * 2; // two seconds of 16 kHz PCM
    while (this.queuedBytes > max && this.queue.length) {
      const old = this.queue.shift()!;
      this.queuedBytes -= typeof old === "string" ? old.length : old.byteLength;
      this.dropped++;
    }
  }

  /** Send a control message (JSON unless it's already a string). */
  sendControl(message: unknown) {
    const text = typeof message === "string" ? message : JSON.stringify(message);
    if (this.socket?.readyState === OPEN) this.socket.send(text);
    else if (!this.closedByUs) this.queue.push(text);
  }

  close(finalMessage?: unknown) {
    this.closedByUs = true;
    this.clearTimer(this.timer);
    this.timer = null;
    this.stopKeepAlive();
    const ws = this.socket;
    if (ws && ws.readyState === OPEN && finalMessage !== undefined)
      ws.send(typeof finalMessage === "string" ? finalMessage : JSON.stringify(finalMessage));
    this.queue = [];
    this.queuedBytes = 0;
    if (ws) ws.close(1000, "session ended");
    else this.setState("closed");
  }
}
