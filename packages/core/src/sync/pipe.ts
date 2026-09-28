import { SyncSession } from "./protocol.js";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/**
 * An in-memory, pausable duplex link between two documents. Used by tests and the spike to simulate a
 * client going offline: while disconnected nothing is delivered; reconnecting runs a fresh handshake.
 */
export class MemoryLink {
  private a: SyncSession | null = null;
  private b: SyncSession | null = null;
  private online = false;

  constructor(
    private readonly left: { doc: Y.Doc; awareness?: Awareness },
    private readonly right: { doc: Y.Doc; awareness?: Awareness },
  ) {}

  connect(): void {
    if (this.online) return;
    this.online = true;
    this.a = new SyncSession(
      this.left.doc,
      { send: (m) => this.online && this.b?.receive(m) },
      this.left.awareness,
    );
    this.b = new SyncSession(
      this.right.doc,
      { send: (m) => this.online && this.a?.receive(m) },
      this.right.awareness,
    );
    this.a.start();
    this.b.start();
  }

  disconnect(): void {
    this.online = false;
    this.a?.destroy();
    this.b?.destroy();
    this.a = this.b = null;
  }

  get isOnline(): boolean {
    return this.online;
  }
}
