import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { IndexedDbRepository } from "../src/data/idb.js";
import { useApp } from "../src/state/app.js";

beforeEach(async () => {
  localStorage.clear();
  window.history.replaceState(null, "", "/library");
  useApp.setState({ repo: new IndexedDbRepository(`test-${Math.random()}`), ready: false, documents: [] });
});

async function seed() {
  render(<App />);
  await screen.findByRole("heading", { name: "Library" });
  const { createDocument, updateDocument } = useApp.getState();
  const a = await createDocument({ title: "Alpha essay" });
  const b = await createDocument({ title: "Beta notes" });
  await updateDocument(b.id, { status: "published", wordCount: 1200 });
  await createDocument({ title: "A template", isTemplate: true });
  return { a, b };
}

describe("library screen", () => {
  it("groups by status with collapsible groups and switches tabs", async () => {
    await seed();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getByText("Alpha essay")).toBeTruthy());
    expect(within(table).getByRole("button", { name: /Published/ })).toBeTruthy();
    expect(within(table).queryByText("A template")).toBeNull();

    await act(async () => within(table).getByRole("button", { name: /Draft/ }).click());
    expect(within(table).queryByText("Alpha essay")).toBeNull();
    expect(within(table).getByRole("button", { name: /Draft/ }).getAttribute("aria-expanded")).toBe("false");

    await act(async () => screen.getByRole("tab", { name: "Templates" }).click());
    expect(await within(screen.getByRole("main")).findByText("A template")).toBeTruthy();
    await act(async () => screen.getByRole("tab", { name: "Published" }).click());
    const main = screen.getByRole("main");
    expect(within(main).getByText("Beta notes")).toBeTruthy();
    expect(within(main).queryByText("Alpha essay")).toBeNull();
  });

  it("supports keyboard navigation and bulk status changes", async () => {
    await seed();
    const wrap = await screen.findByLabelText(/Use arrow keys/);
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Alpha essay")).toBeTruthy());
    wrap.focus();
    fireEvent.keyDown(wrap, { key: "a", ctrlKey: true });
    expect(await screen.findByText(/selected/)).toBeTruthy();
    const bulk = screen.getByRole("region", { name: "Bulk actions" });
    await act(async () => {
      fireEvent.change(within(bulk).getByLabelText("Set status"), { target: { value: "in_review" } });
    });
    await waitFor(() =>
      expect(
        useApp.getState().documents.filter((d) => !d.isTemplate && d.status === "in_review").length,
      ).toBeGreaterThanOrEqual(2),
    );
    fireEvent.keyDown(wrap, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();

    fireEvent.keyDown(wrap, { key: "ArrowDown" });
    fireEvent.keyDown(wrap, { key: "Enter" });
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/d\//));
  });

  it("filters by text", async () => {
    await seed();
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Alpha essay")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Filter documents"), { target: { value: "beta" } });
    const table = screen.getByRole("table");
    expect(within(table).queryByText("Alpha essay")).toBeNull();
    expect(within(table).getByText("Beta notes")).toBeTruthy();
  });
});
