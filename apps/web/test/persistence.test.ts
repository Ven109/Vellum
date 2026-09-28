import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LocalDocPersistence } from "../src/data/local-persistence.js";

async function settle(p: LocalDocPersistence) {
  for (let i = 0; i < 50 && p.isWriting; i++) await new Promise((r) => setTimeout(r, 5));
}

describe("LocalDocPersistence", () => {
  it("writes every update and restores it after a 'crash'", async () => {
    const id = `doc_${Math.random().toString(36).slice(2)}`;
    const doc = new Y.Doc();
    const p = new LocalDocPersistence(id, doc);
    await p.whenLoaded;
    const states: boolean[] = [];
    p.onChange(() => states.push(p.isWriting));
    doc.getText("t").insert(0, "unsaved thought");
    expect(p.isWriting).toBe(true);
    await settle(p);
    expect(p.isWriting).toBe(false);
    expect(states).toContain(true);
    // Simulate the tab dying without any cleanup, then reopening.
    const reopened = new Y.Doc();
    const p2 = new LocalDocPersistence(id, reopened);
    await p2.whenLoaded;
    expect(reopened.getText("t").toString()).toBe("unsaved thought");
    p.destroy();
    p2.destroy();
  });

  it("compacts without losing content", async () => {
    const id = `doc_${Math.random().toString(36).slice(2)}`;
    const doc = new Y.Doc();
    const p = new LocalDocPersistence(id, doc);
    await p.whenLoaded;
    for (let i = 0; i < 20; i++) doc.getText("t").insert(i, "x");
    await settle(p);
    await p.compact();
    const again = new Y.Doc();
    const p2 = new LocalDocPersistence(id, again);
    await p2.whenLoaded;
    expect(again.getText("t").toString()).toBe("x".repeat(20));
  });
});
