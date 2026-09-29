import type { DocumentMeta } from "@vellum/core";
import { describe, expect, it } from "vitest";
import { useApp } from "../src/state/app.js";

type State = ReturnType<typeof useApp.getState>;

/** A repository whose writes land only when told to. */
function slowRepo() {
  const stored: DocumentMeta[] = [];
  let land: () => void = () => undefined;
  const repo = {
    listWorkspaces: async () => [],
    listCollections: async () => [],
    listDocuments: async () => [...stored],
    putDocument: (doc: DocumentMeta) =>
      new Promise<void>((resolve) => {
        land = () => {
          stored.push(doc);
          resolve();
        };
      }),
    deleteDocument: async (id: string) => {
      const i = stored.findIndex((d) => d.id === id);
      if (i >= 0) stored.splice(i, 1);
    },
  };
  return { repo, land: () => land() };
}

describe("refresh", () => {
  it("keeps a new draft whose write hasn't landed yet, and doesn't bring back a deleted one", async () => {
    const { repo, land } = slowRepo();
    useApp.setState({
      repo: repo as unknown as State["repo"],
      workspace: { id: "ws_1" } as State["workspace"],
      user: { id: "usr_1" } as State["user"],
      documents: [],
    });
    const doc = await useApp.getState().createDocument();
    // Something else (background sync) refreshes before the draft is stored.
    await useApp.getState().refresh();
    expect(useApp.getState().documents.map((d) => d.id)).toEqual([doc.id]);
    land();
    await useApp.getState().refresh();
    expect(useApp.getState().documents.map((d) => d.id)).toEqual([doc.id]);

    await useApp.getState().deleteDocuments([doc.id]);
    await useApp.getState().refresh();
    expect(useApp.getState().documents).toEqual([]);
  });
});
