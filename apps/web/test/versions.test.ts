import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbRepository } from "../src/data/idb.js";
import { getVersion, listVersions, nameVersion, recordVersion } from "../src/data/versions.js";
import { useApp } from "../src/state/app.js";

beforeEach(async () => {
  useApp.setState({
    repo: new IndexedDbRepository(`test-${Math.random()}`),
    ready: false,
    documents: [],
    account: null,
  });
  await useApp.getState().init();
});

const me = { kind: "user" as const, userId: "usr_me" };

describe("local version history", () => {
  it("records versions with word-level change counts against the previous one", async () => {
    await recordVersion("doc_a", "one two three", me, "autosave");
    const v2 = await recordVersion("doc_a", "one two four five", me, "autosave", undefined, "Title");
    expect(v2.stats).toEqual({ wordsAdded: 2, wordsRemoved: 1, wordCount: 4 });
    expect(v2.title).toBe("Title");
    const list = await listVersions("doc_a");
    expect(list.map((v) => v.id)).toEqual([v2.id, list[1]!.id]);
    expect((await getVersion("doc_a", v2.id))?.markdown).toBe("one two four five");
  });

  it("prunes old automatic versions by the workspace policy but keeps named ones", async () => {
    await useApp
      .getState()
      .updateWorkspaceSettings({ retention: { keepAllForDays: 1, keepDailyForDays: 0, keepNamed: true } });
    const repo = useApp.getState().repo;
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await repo.putVersion({
      id: "ver_old",
      documentId: "doc_b",
      createdAt: old,
      author: me,
      reason: "autosave",
      stats: { wordsAdded: 0, wordsRemoved: 0, wordCount: 1 },
      markdown: "x",
    });
    await repo.putVersion({
      id: "ver_named",
      documentId: "doc_b",
      createdAt: old,
      author: me,
      reason: "autosave",
      stats: { wordsAdded: 0, wordsRemoved: 0, wordCount: 1 },
      markdown: "x",
    });
    await nameVersion("doc_b", "ver_named", "Keep me");
    const fresh = await recordVersion("doc_b", "x y", me, "autosave");
    expect((await listVersions("doc_b")).map((v) => v.id)).toEqual([fresh.id, "ver_named"]);
  });
});
