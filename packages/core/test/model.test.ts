import { describe, expect, it } from "vitest";
import {
  CommentThread,
  DocumentMeta,
  Version,
  WorkspaceSettings,
  createId,
  idPrefix,
  roleAtLeast,
} from "../src/index.js";

const now = "2026-09-28T10:00:00.000Z";

describe("ids", () => {
  it("are prefixed, unique and time-sortable", () => {
    const a = createId("doc", 1_000);
    const b = createId("doc", 2_000);
    expect(a).toMatch(/^doc_[0-9a-z]{26}$/);
    expect(idPrefix(a)).toBe("doc");
    expect(a < b).toBe(true);
    expect(createId("doc")).not.toBe(createId("doc"));
  });
});

describe("model", () => {
  it("fills workspace setting defaults", () => {
    const s = WorkspaceSettings.parse({});
    expect(s.voice.learnFromPublished).toBe(true);
    expect(s.retention.keepNamed).toBe(true);
    expect(s.dailyGoalWords).toBe(500);
  });

  it("validates document metadata", () => {
    const doc = DocumentMeta.parse({
      id: "doc_1",
      workspaceId: "wsp_1",
      collectionId: null,
      title: "On workshops",
      status: "draft",
      ownerId: "usr_1",
      createdAt: now,
      updatedAt: now,
    });
    expect(doc.tags).toEqual([]);
    expect(() => DocumentMeta.parse({ ...doc, status: "nope" })).toThrow();
  });

  it("requires attribution on every version", () => {
    const base = {
      id: "ver_1",
      documentId: "doc_1",
      createdAt: now,
      reason: "assistant",
      stats: { wordsAdded: 3, wordsRemoved: 1, wordCount: 100 },
      markdown: "# Hi\n",
    };
    expect(() => Version.parse(base)).toThrow();
    const v = Version.parse({
      ...base,
      author: { kind: "assistant", providerId: "anthropic", model: "claude", requestedBy: "usr_1" },
    });
    expect(v.author.kind).toBe("assistant");
  });

  it("requires at least one comment per thread", () => {
    const anchor = { start: "a", end: "b", quote: "text" };
    expect(() =>
      CommentThread.parse({ id: "thr_1", documentId: "doc_1", anchor, status: "open", comments: [] }),
    ).toThrow();
  });

  it("orders share roles", () => {
    expect(roleAtLeast("edit", "suggest")).toBe(true);
    expect(roleAtLeast("comment", "suggest")).toBe(false);
    expect(roleAtLeast("view", "view")).toBe(true);
  });
});
