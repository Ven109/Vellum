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

describe("refresh while a document changes", () => {
  it("keeps a title typed after the refresh started reading", async () => {
    const stored: DocumentMeta[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const repo = {
      listWorkspaces: async () => [],
      listCollections: async () => [],
      // Reads what's stored now, but answers only when released: a slow read.
      listDocuments: async () => {
        const snapshot = stored.map((d) => ({ ...d }));
        await gate;
        return snapshot;
      },
      putDocument: async (doc: DocumentMeta) => {
        const i = stored.findIndex((d) => d.id === doc.id);
        if (i >= 0) stored[i] = doc;
        else stored.push(doc);
      },
      getDocument: async (id: string) => stored.find((d) => d.id === id),
      deleteDocument: async () => undefined,
      putSetting: async () => undefined,
    };
    useApp.setState({
      repo: repo as unknown as State["repo"],
      workspace: { id: "ws_1" } as State["workspace"],
      user: { id: "usr_1" } as State["user"],
      documents: [],
    });
    const doc = await useApp.getState().createDocument();
    await new Promise((r) => setTimeout(r, 0));
    const refreshing = useApp.getState().refresh();
    await useApp
      .getState()
      .updateDocument(doc.id, { title: "Keyboard pick", updatedAt: "2999-01-01T00:00:00.000Z" });
    release();
    await refreshing;
    expect(useApp.getState().documents.find((d) => d.id === doc.id)?.title).toBe("Keyboard pick");
  });
});
