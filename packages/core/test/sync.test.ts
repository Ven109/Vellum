import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { sync } from "../src/index.js";

const { MemoryLink, docFromState, encodeState, compactUpdates } = sync;

function text(doc: Y.Doc): string {
  return doc.getText("body").toString();
}

describe("CRDT sync prototype", () => {
  it("two clients converge through a relay server, including offline edits", () => {
    const server = new Y.Doc();
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const aliceLink = new MemoryLink({ doc: alice }, { doc: server });
    const bobLink = new MemoryLink({ doc: bob }, { doc: server });
    aliceLink.connect();
    bobLink.connect();

    alice.getText("body").insert(0, "Every workshop has one tool.");
    expect(text(bob)).toBe("Every workshop has one tool.");

    // Both go offline and edit the same sentence concurrently.
    aliceLink.disconnect();
    bobLink.disconnect();
    alice.getText("body").insert(27, " nobody talks about");
    bob.getText("body").insert(0, "Honestly: ");
    bob.getText("body").delete(bob.getText("body").length - 1, 1);
    bob.getText("body").insert(bob.getText("body").length, "!");
    expect(text(alice)).not.toBe(text(bob));

    // Reconnect in either order: all three replicas converge, nothing is lost.
    bobLink.connect();
    aliceLink.connect();
    expect(text(alice)).toBe(text(bob));
    expect(text(server)).toBe(text(alice));
    expect(text(alice)).toBe("Honestly: Every workshop has one tool nobody talks about!");
  });

  it("converges regardless of the order updates arrive in", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const updates: Uint8Array[] = [];
    a.on("update", (u: Uint8Array) => updates.push(u));
    a.getText("body").insert(0, "one ");
    a.getText("body").insert(4, "two ");
    a.getText("body").insert(8, "three");
    for (const u of [...updates].reverse()) Y.applyUpdate(b, u);
    expect(text(b)).toBe("one two three");
    expect(text(docFromState(compactUpdates(updates)))).toBe("one two three");
  });

  it("snapshots restore an earlier state", () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "first draft");
    const v1 = encodeState(doc);
    doc.getText("body").delete(0, 5);
    doc.getText("body").insert(0, "second");
    expect(text(docFromState(v1))).toBe("first draft");
    expect(text(doc)).toBe("second draft");
  });

  it("anchors survive concurrent edits via relative positions", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const link = new MemoryLink({ doc: a }, { doc: b });
    link.connect();
    a.getText("body").insert(0, "The quick brown fox");
    const t = a.getText("body");
    const start = Y.createRelativePositionFromTypeIndex(t, 10);
    const end = Y.createRelativePositionFromTypeIndex(t, 15);
    b.getText("body").insert(0, "Look: ");
    const s = Y.createAbsolutePositionFromRelativePosition(start, a)!;
    const e = Y.createAbsolutePositionFromRelativePosition(end, a)!;
    expect(t.toString().slice(s.index, e.index)).toBe("brown");
  });

  it("shares presence through awareness", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const aw1 = new Awareness(a);
    const aw2 = new Awareness(b);
    aw1.setLocalState({ user: { name: "Alice" }, cursor: 3 });
    const link = new MemoryLink({ doc: a, awareness: aw1 }, { doc: b, awareness: aw2 });
    link.connect();
    expect(aw2.getStates().get(a.clientID)).toMatchObject({ user: { name: "Alice" } });
    aw1.setLocalStateField("cursor", 7);
    expect(aw2.getStates().get(a.clientID)).toMatchObject({ cursor: 7 });
  });
});

describe("acknowledgements", () => {
  it("server acks after persisting, client knows its edits are covered", async () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    const persisted: number[] = [];
    let lastAck: Uint8Array | null = null;
    // eslint-disable-next-line prefer-const
    let serverSession: sync.SyncSession;
    const clientSession = new sync.SyncSession(
      client,
      { send: (m) => void serverSession.receive(m) },
      {
        onAck: (sv) => (lastAck = sv),
      },
    );
    serverSession = new sync.SyncSession(
      server,
      { send: (m) => void clientSession.receive(m) },
      {
        sendAcks: true,
        beforeAck: async () => {
          persisted.push(Y.encodeStateAsUpdate(server).length);
        },
      },
    );
    clientSession.start();
    serverSession.start();
    client.getText("body").insert(0, "hello");
    await new Promise((r) => setTimeout(r, 0));
    expect(persisted.length).toBeGreaterThan(0);
    expect(lastAck).not.toBeNull();
    expect(sync.stateVectorCovers(lastAck!, Y.encodeStateVector(client))).toBe(true);
    client.getText("body").insert(5, " world");
    expect(sync.stateVectorCovers(lastAck!, Y.encodeStateVector(client))).toBe(false);
  });

  it("batches local updates and reports remote changes", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const sent: Uint8Array[] = [];
    const remote: Uint8Array[] = [];
    // eslint-disable-next-line prefer-const
    let sb: sync.SyncSession;
    const sa = new sync.SyncSession(
      a,
      {
        send: (m) => {
          sent.push(m);
          void sb.receive(m);
        },
      },
      { batchMs: 10 },
    );
    sb = new sync.SyncSession(
      b,
      { send: (m) => void sa.receive(m) },
      { onRemoteUpdate: (u) => remote.push(u) },
    );
    a.getText("t").insert(0, "a");
    a.getText("t").insert(1, "b");
    a.getText("t").insert(2, "c");
    expect(sent.length).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.length).toBe(1);
    expect(b.getText("t").toString()).toBe("abc");
    expect(remote.length).toBe(1);
  });
});
