import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbRepository } from "../src/data/idb.js";
import { recordVersion } from "../src/data/versions.js";
import { useApp } from "../src/state/app.js";

beforeEach(async () => {
  useApp.setState({ repo: new IndexedDbRepository(`test-${Math.random()}`), ready: false, documents: [] });
});

describe("recordVersion", () => {
  it("attributes assistant edits and records word deltas against the previous version", async () => {
    await recordVersion(
      "doc_1",
      "Every workshop has one tool.\n",
      { kind: "user", userId: "usr_1" },
      "checkpoint",
    );
    const v = await recordVersion(
      "doc_1",
      "Every workshop has a quiet tool.\n",
      { kind: "assistant", providerId: "anthropic", model: "claude-opus-5-5", requestedBy: "usr_1" },
      "assistant",
    );
    expect(v.author).toMatchObject({ kind: "assistant", model: "claude-opus-5-5" });
    expect(v.stats).toEqual({ wordsAdded: 2, wordsRemoved: 1, wordCount: 6 });
    const all = await useApp.getState().repo.listVersions("doc_1");
    expect(all.map((x) => x.reason)).toEqual(["assistant", "checkpoint"]);
  });
});
