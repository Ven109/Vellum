import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";

/**
 * Vellum's sync wire protocol. It is deliberately the same framing as y-websocket (message type varint,
 * then payload) so any Yjs provider can talk to a Vellum server, but the transport is abstract: the same
 * session runs over a WebSocket, an Electron IPC channel or an in-memory pipe in tests.
 */
export const MessageType = {
  Sync: 0,
  Awareness: 1,
} as const;

/** Origin tag used for updates applied from the remote side, so they are not echoed back. */
export const REMOTE_ORIGIN = Symbol("vellum-remote");

export interface SyncTransport {
  send(message: Uint8Array): void;
}

/**
 * One side of a sync connection for a single document. Call {@link start} when the transport opens and
 * {@link receive} for every incoming message. Local document updates are forwarded automatically.
 */
export class SyncSession {
  private synced = false;
  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MessageType.Sync);
    syncProtocol.writeUpdate(enc, update);
    this.transport.send(encoding.toUint8Array(enc));
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
    private readonly awareness?: awarenessProtocol.Awareness,
  ) {
    doc.on("update", this.onUpdate);
    awareness?.on("update", this.onAwareness);
  }

  get isSynced(): boolean {
    return this.synced;
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

  receive(message: Uint8Array): void {
    const dec = decoding.createDecoder(message);
    const type = decoding.readVarUint(dec);
    if (type === MessageType.Sync) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MessageType.Sync);
      const kind = syncProtocol.readSyncMessage(dec, enc, this.doc, this);
      if (kind === syncProtocol.messageYjsSyncStep2) this.synced = true;
      if (encoding.length(enc) > 1) this.transport.send(encoding.toUint8Array(enc));
    } else if (type === MessageType.Awareness && this.awareness) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this);
    }
  }

  destroy(): void {
    this.doc.off("update", this.onUpdate);
    this.awareness?.off("update", this.onAwareness);
  }
}
