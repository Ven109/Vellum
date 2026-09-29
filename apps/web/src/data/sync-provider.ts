import { sync } from "@vellum/core";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "denied";

export interface SyncProviderEvents {
  /**
   * Remote changes were merged into a document that also had local unsynced edits. `before` is the
   * document as it was on this device just before (a Yjs update), so nothing written offline is lost.
   */
  merged?: (before: Uint8Array) => void;
  change?: () => void;
  /** The server refused access (4401 signed out, 4403 no access or read-only). */
  denied?: (code: number, reason: string) => void;
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
  private beforeMerge: Uint8Array | null = null;
  /** Why the server refused the connection, when state is "denied". */
  denial = "";
  private readonly onOnline = () => this.connectSoon(0);
  /** The browser knows the network is gone; don't wait for the socket to time out. */
  private readonly onOffline = () => this.ws?.close();

  constructor(
    readonly docId: string,
    readonly doc: Y.Doc,
    private readonly url: string,
    private readonly events: SyncProviderEvents = {},
    private readonly opts: {
      batchMs?: number;
      WebSocketImpl?: typeof WebSocket;
      /** Presence (cursors, who's here) shared with everyone in the document. */
      awareness?: awarenessProtocol.Awareness;
    } = {},
  ) {
    this.acked = loadAcked(docId);
    doc.on("update", this.onLocalUpdate);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.connect();
  }

  private readonly onLocalUpdate = () => this.events.change?.();

  /** True once the first exchange with the server has completed on the current connection. */
  get isSynced(): boolean {
    return this.state === "connected" && !!this.session?.isSynced;
  }

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
      this.beforeMerge = this.hadPendingOnConnect ? Y.encodeStateAsUpdate(this.doc) : null;
      this.session = new sync.SyncSession(
        this.doc,
        { send: (m) => ws.readyState === ws.OPEN && ws.send(m) },
        {
          batchMs: this.opts.batchMs ?? 400,
          ...(this.opts.awareness ? { awareness: this.opts.awareness } : {}),
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
              this.events.merged?.(this.beforeMerge ?? new Uint8Array());
              this.beforeMerge = null;
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
    ws.onclose = (ev: CloseEvent) => {
      this.session?.destroy();
      this.session = null;
      this.ws = null;
      this.dropRemotePresence();
      // 4401/4403: signed out, no access, or a change this role may not make. Retrying won't help.
      if (ev.code === 4401 || ev.code === 4403) {
        this.state = "denied";
        this.denial = ev.reason;
        this.events.change?.();
        this.events.denied?.(ev.code, ev.reason);
        return;
      }
      this.state = "disconnected";
      this.events.change?.();
      this.connectSoon();
    };
    ws.onerror = () => ws.close();
  }

  /** People who were here through this connection are gone once it closes. */
  private dropRemotePresence() {
    const a = this.opts.awareness;
    if (!a) return;
    const others = [...a.getStates().keys()].filter((id) => id !== a.clientID);
    if (others.length) awarenessProtocol.removeAwarenessStates(a, others, this);
  }

  private connectSoon(delay?: number) {
    if (this.destroyed || this.ws || this.state === "denied") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return; // resumes on "online"

    clearTimeout(this.retryTimer);
    const ms = delay ?? Math.min(30_000, 500 * 2 ** this.retry++) * (0.75 + Math.random() * 0.5);
    this.retryTimer = setTimeout(() => this.connect(), ms);
  }

  /** Try again after access changed (for example after opening a share link). */
  reconnect(): void {
    if (this.state !== "denied") return;
    this.state = "disconnected";
    this.connectSoon(0);
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
