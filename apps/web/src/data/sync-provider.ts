import { sync } from "@vellum/core";
import * as Y from "yjs";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface SyncProviderEvents {
  /** Remote changes were merged into a document that also had local unsynced edits. */
  merged?: () => void;
  change?: () => void;
}

const ACK_KEY = (docId: string) => `vellum:acked:${docId}`;

function loadAcked(docId: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(ACK_KEY(docId));
    return raw ? sync.fromBase64(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Keeps one document in sync with the server over a WebSocket. Local edits are batched (debounced
 * autosave), the server acknowledges each persisted batch, and we remember the last acknowledged state
 * so that after a crash or reload we know whether there are unsynced local changes to push.
 */
export class DocSyncProvider {
  state: ConnectionState = "disconnected";
  private ws: WebSocket | null = null;
  private session: sync.SyncSession | null = null;
  private acked: Uint8Array | null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private hadPendingOnConnect = false;
  private readonly onOnline = () => this.connectSoon(0);
  /** The browser knows the network is gone; don't wait for the socket to time out. */
  private readonly onOffline = () => this.ws?.close();

  constructor(
    readonly docId: string,
    readonly doc: Y.Doc,
    private readonly url: string,
    private readonly events: SyncProviderEvents = {},
    private readonly opts: { batchMs?: number; WebSocketImpl?: typeof WebSocket } = {},
  ) {
    this.acked = loadAcked(docId);
    doc.on("update", this.onLocalUpdate);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.connect();
  }

  private readonly onLocalUpdate = () => this.events.change?.();

  /** Local changes the server has not yet confirmed. */
  get hasPendingChanges(): boolean {
    const local = Y.encodeStateVector(this.doc);
    if (!this.acked) return Y.decodeStateVector(local).size > 0;
    return !sync.stateVectorCovers(this.acked, local);
  }

  private connect() {
    if (this.destroyed) return;
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    this.state = "connecting";
    this.events.change?.();
    const ws = new WS(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.state = "connected";
      this.hadPendingOnConnect = this.hasPendingChanges;
      this.session = new sync.SyncSession(
        this.doc,
        { send: (m) => ws.readyState === ws.OPEN && ws.send(m) },
        {
          batchMs: this.opts.batchMs ?? 400,
          onAck: (sv) => {
            this.acked = sv;
            try {
              localStorage.setItem(ACK_KEY(this.docId), sync.toBase64(sv));
            } catch {
              /* storage full or disabled: acks still work for this session */
            }
            this.events.change?.();
          },
          onRemoteUpdate: () => {
            if (this.hadPendingOnConnect) {
              this.hadPendingOnConnect = false;
              this.events.merged?.();
            }
          },
        },
      );
      this.session.start();
      // Push anything the server may be missing right away rather than waiting for its step 1.
      this.events.change?.();
    };
    ws.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      void this.session?.receive(new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      this.session?.destroy();
      this.session = null;
      this.ws = null;
      this.state = "disconnected";
      this.events.change?.();
      this.connectSoon();
    };
    ws.onerror = () => ws.close();
  }

  private connectSoon(delay?: number) {
    if (this.destroyed || this.ws) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return; // resumes on "online"

    clearTimeout(this.retryTimer);
    const ms = delay ?? Math.min(30_000, 500 * 2 ** this.retry++) * (0.75 + Math.random() * 0.5);
    this.retryTimer = setTimeout(() => this.connect(), ms);
  }

  /** Force-send batched edits now (e.g. before the page unloads). */
  flush(): void {
    this.session?.flush();
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.retryTimer);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    this.doc.off("update", this.onLocalUpdate);
    this.session?.flush();
    this.session?.destroy();
    this.ws?.close();
  }
}
