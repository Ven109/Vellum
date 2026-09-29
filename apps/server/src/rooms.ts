import { sync } from "@vellum/core";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import type * as Y from "yjs";
import { COMPACT_THRESHOLD } from "./doc-store.js";
import type { DocStore } from "./doc-store.js";
import { checkWrite } from "./sharing/guard.js";

export interface Connection {
  send(data: Uint8Array): void;
  close(): void;
}

interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  sessions: Map<Connection, { session: sync.SyncSession; clients: Set<number> }>;
}

/**
 * In-memory rooms, one per open document. Every connection gets a SyncSession on the shared Y.Doc, so
 * updates from one client are persisted and fanned out to the others. The server is a plain Yjs peer;
 * no third-party realtime service is involved.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly store: DocStore) {}

  get openRooms(): number {
    return this.rooms.size;
  }

  private room(docId: string): Room {
    let room = this.rooms.get(docId);
    if (!room) {
      const doc = this.store.load(docId);
      doc.on("update", (update: Uint8Array) => this.store.append(docId, update));
      const awareness = new awarenessProtocol.Awareness(doc);
      awareness.setLocalState(null);
      room = { doc, awareness, sessions: new Map() };
      this.rooms.set(docId, room);
    }
    return room;
  }

  /** Attach a connection to a document room. Returns a handler for incoming messages. */
  join(
    docId: string,
    conn: Connection,
    opts: { writableRoots?: readonly string[] | null } = {},
  ): { receive(data: Uint8Array): Promise<void>; leave(): void } {
    const room = this.room(docId);
    const clients = new Set<number>();
    const session = new sync.SyncSession(
      room.doc,
      { send: (m) => conn.send(m) },
      {
        awareness: room.awareness,
        sendAcks: true,
      },
    );
    const trackClients = ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
      if (origin === session) for (const c of [...added, ...updated]) clients.add(c);
    };
    room.awareness.on("update", trackClients);
    room.sessions.set(conn, { session, clients });
    session.start();
    // Tell the newcomer who is already here.
    const present = [...room.awareness.getStates().keys()];
    if (present.length) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, sync.MessageType.Awareness);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, present));
      conn.send(encoding.toUint8Array(enc));
    }

    return {
      receive: async (data) => {
        // Viewers and commenters may only change what their role allows; anything else is refused.
        checkWrite(room.doc, data, opts.writableRoots ?? null);
        await session.receive(data);
      },
      leave: () => {
        room.awareness.off("update", trackClients);
        session.destroy();
        room.sessions.delete(conn);
        awarenessProtocol.removeAwarenessStates(room.awareness, [...clients], "disconnect");
        if (room.sessions.size === 0) this.close(docId);
      },
    };
  }

  private close(docId: string) {
    const room = this.rooms.get(docId);
    if (!room) return;
    this.rooms.delete(docId);
    if (this.store.count(docId) > COMPACT_THRESHOLD) this.store.compact(docId);
    room.awareness.destroy();
    room.doc.destroy();
  }

  /** Current in-memory doc for a room, if open. */
  peek(docId: string): Y.Doc | undefined {
    return this.rooms.get(docId)?.doc;
  }

  closeAll(): void {
    for (const [docId, room] of this.rooms) {
      for (const conn of room.sessions.keys()) conn.close();
      this.close(docId);
    }
  }
}
