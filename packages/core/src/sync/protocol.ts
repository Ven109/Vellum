import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

/**
 * Vellum's sync wire protocol. Message types 0 and 1 are the y-websocket framing (sync, awareness), so
 * any Yjs provider can talk to a Vellum server. Type 2 is a Vellum extension: after the server has durably
 * stored an update it replies with its state vector, which is how clients know their edits are saved.
 * The transport is abstract: the same session runs over a WebSocket, an Electron IPC channel or an
 * in-memory pipe in tests.
 */
export const MessageType = {
  Sync: 0,
  Awareness: 1,
  Ack: 2,
} as const;

export interface SyncTransport {
  send(message: Uint8Array): void;
}

export interface SyncSessionOptions {
  awareness?: awarenessProtocol.Awareness;
  /** Server side: reply with an Ack after applying updates from the peer. */
  sendAcks?: boolean;
  /**
   * Called before an Ack is sent so the server can persist first. The Ack is only sent once the
   * returned promise resolves.
   */
  beforeAck?: () => Promise<void> | void;
  /** Client side: called with the peer's state vector each time it acknowledges our updates. */
  onAck?: (stateVector: Uint8Array) => void;
  /** Called whenever an update from the peer changed the document. */
  onRemoteUpdate?: (update: Uint8Array) => void;
  /** Batch outgoing local updates for this many milliseconds (0 = send immediately). */
  batchMs?: number;
}

/**
 * One side of a sync connection for a single document. Call {@link start} when the transport opens and
 * {@link receive} for every incoming message. Local document updates are forwarded automatically.
 */
export class SyncSession {
  private synced = false;
  private pending: Uint8Array[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly awareness?: awarenessProtocol.Awareness;

  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    if (this.options.batchMs && this.options.batchMs > 0) {
      this.pending.push(update);
      if (!this.batchTimer) this.batchTimer = setTimeout(() => this.flush(), this.options.batchMs);
    } else {
      this.sendUpdate(update);
    }
  };

  private readonly onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (!this.awareness || origin === this) return;
    const changed = added.concat(updated, removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Awareness);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
    this.transport.send(encoding.toUint8Array(enc));
  };

  constructor(
    readonly doc: Y.Doc,
    private readonly transport: SyncTransport,
    awarenessOrOptions?: awarenessProtocol.Awareness | SyncSessionOptions,
    private readonly options: SyncSessionOptions = {},
  ) {
    if (awarenessOrOptions instanceof awarenessProtocol.Awareness) {
      this.awareness = awarenessOrOptions;
    } else if (awarenessOrOptions) {
      this.options = awarenessOrOptions;
      this.awareness = awarenessOrOptions.awareness;
    }
    doc.on("update", this.onUpdate);
    this.awareness?.on("update", this.onAwareness);
  }

  get isSynced(): boolean {
    return this.synced;
  }

  /** Send any batched local updates now. */
  flush(): void {
    clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    if (this.pending.length === 0) return;
    const merged = this.pending.length === 1 ? this.pending[0]! : Y.mergeUpdates(this.pending);
    this.pending = [];
    this.sendUpdate(merged);
  }

  private sendUpdate(update: Uint8Array) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Sync);
    syncProtocol.writeUpdate(enc, update);
    this.transport.send(encoding.toUint8Array(enc));
  }

  /** Begin the handshake: send our state vector so the peer can reply with what we are missing. */
  start(): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Sync);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.transport.send(encoding.toUint8Array(enc));
    if (this.awareness && this.awareness.getLocalState() !== null) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MessageType.Awareness);
      encoding.writeVarUint8Array(
        a,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]),
      );
      this.transport.send(encoding.toUint8Array(a));
    }
  }

  receive(message: Uint8Array): void | Promise<void> {
    const dec = decoding.createDecoder(message);
    const type = decoding.readVarUint(dec);
    if (type === MessageType.Sync) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MessageType.Sync);
      const before = this.options.onRemoteUpdate ? Y.encodeStateVector(this.doc) : null;
      const kind = syncProtocol.readSyncMessage(dec, enc, this.doc, this);
      if (kind === syncProtocol.messageYjsSyncStep2) this.synced = true;
      if (encoding.length(enc) > 1) this.transport.send(encoding.toUint8Array(enc));
      if (before && kind !== syncProtocol.messageYjsSyncStep1) {
        const diff = Y.encodeStateAsUpdate(this.doc, before);
        if (!isEmptyUpdate(diff)) this.options.onRemoteUpdate?.(diff);
      }
      if (this.options.sendAcks && kind !== syncProtocol.messageYjsSyncStep1) {
        return Promise.resolve(this.options.beforeAck?.()).then(() => this.sendAck());
      }
    } else if (type === MessageType.Awareness && this.awareness) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this);
    } else if (type === MessageType.Ack) {
      this.options.onAck?.(decoding.readVarUint8Array(dec));
    }
  }

  private sendAck() {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Ack);
    encoding.writeVarUint8Array(enc, Y.encodeStateVector(this.doc));
    this.transport.send(encoding.toUint8Array(enc));
  }

  destroy(): void {
    clearTimeout(this.batchTimer);
    this.doc.off("update", this.onUpdate);
    this.awareness?.off("update", this.onAwareness);
  }
}

function isEmptyUpdate(update: Uint8Array): boolean {
  // An update with no structs and an empty delete set encodes to exactly two zero bytes.
  return update.length <= 2 && update.every((b) => b === 0);
}

/**
 * True when every change in `local` is covered by `remote` — i.e. the peer that sent `remote` has all of
 * our edits. Both arguments are encoded state vectors.
 */
export function stateVectorCovers(remote: Uint8Array, local: Uint8Array): boolean {
  const r = Y.decodeStateVector(remote);
  for (const [client, clock] of Y.decodeStateVector(local)) {
    if ((r.get(client) ?? 0) < clock) return false;
  }
  return true;
}
