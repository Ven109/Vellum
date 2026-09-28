import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { IndexedDbRepository } from "../src/data/idb.js";
import { useApp } from "../src/state/app.js";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/library");
  useApp.setState({
    repo: new IndexedDbRepository(`test-${Math.random()}`),
    ready: false,
    documents: [],
    collections: [],
  });
});

function dataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (k: string, v: string) => data.set(k, v),
    getData: (k: string) => data.get(k) ?? "",
    get types() {
      return [...data.keys()];
    },
    dropEffect: "move",
    effectAllowed: "move",
  };
}

describe("collections", () => {
  it("reorders, recolours and deletes collections, keeping documents", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Library" });
    const s = useApp.getState();
    const notes = await s.createCollection("Notes");
    const doc = await s.createDocument({ title: "In notes", collectionId: notes.id });
    const essays = useApp.getState().collections.find((c) => c.name === "Essays")!;

    await s.reorderCollections([notes.id, essays.id]);
    expect(useApp.getState().collections.map((c) => c.name)).toEqual(["Notes", "Essays"]);

    await s.updateCollection(notes.id, { color: "#1D4ED8", name: "Field notes" });
    expect(useApp.getState().collections[0]).toMatchObject({ name: "Field notes", color: "#1D4ED8" });

    await s.deleteCollection(notes.id);
    expect(useApp.getState().collections.map((c) => c.name)).toEqual(["Essays"]);
    expect(useApp.getState().documents.find((d) => d.id === doc.id)?.collectionId).toBeNull();
    // Persisted too.
    expect((await s.repo.listCollections(useApp.getState().workspace!.id)).length).toBe(1);
  });

  it("moves a document by dragging it onto a collection", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Library" });
    await act(async () => {
      await useApp.getState().createCollection("Letters");
      await useApp.getState().createDocument({ title: "Dear reader" });
    });
    const sidebar = screen.getByRole("navigation", { name: "Workspace" });
    const link = await within(sidebar).findByRole("link", { name: "Dear reader" });
    const target = within(sidebar).getByText("Letters").closest(".vl-collection")!;
    const dt = dataTransfer();
    fireEvent.dragStart(link, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    const letters = useApp.getState().collections.find((c) => c.name === "Letters")!;
    await waitFor(() =>
      expect(useApp.getState().documents.find((d) => d.title === "Dear reader")?.collectionId).toBe(
        letters.id,
      ),
    );
  });
});
