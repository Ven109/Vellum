import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { IndexedDbRepository } from "../src/data/idb.js";
import { useApp } from "../src/state/app.js";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  useApp.setState({ repo: new IndexedDbRepository(`test-${Math.random()}`), ready: false, documents: [] });
});

/** The first launch offers setup; skip it to get to the library. */
async function skipSetup() {
  await waitFor(() => expect(window.location.pathname).toBe("/welcome"));
  await act(async () => (await screen.findByRole("button", { name: "Skip setup" })).click());
  await waitFor(() => expect(window.location.pathname).toBe("/library"));
}

describe("editor screen", () => {
  it("seeds a workspace, offers setup, and opens the welcome draft", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Name your workspace" })).toBeTruthy();
    await skipSetup();
    await act(async () =>
      (
        await within(await screen.findByRole("table")).findByRole("link", { name: "Welcome to Vellum" })
      ).click(),
    );
    expect(await screen.findByDisplayValue("Welcome to Vellum")).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/d\/doc_/));
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Essays");
    await waitFor(() =>
      expect(Number(screen.getByTestId("word-count").textContent?.split(" ")[0])).toBeGreaterThan(20),
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved"));
    expect(await screen.findByText("A few things to try", { selector: "button" })).toBeTruthy();
  });

  it("creates a new draft from the sidebar", async () => {
    render(<App />);
    await skipSetup();
    const before = window.location.pathname;
    await act(async () =>
      within(screen.getByRole("navigation", { name: "Workspace" }))
        .getByRole("button", { name: /New draft/ })
        .click(),
    );
    await waitFor(() => expect(window.location.pathname).not.toBe(before));
    expect(await screen.findByPlaceholderText("Untitled")).toBeTruthy();
    expect(screen.getAllByText("Untitled").length).toBeGreaterThan(0);
  });
});

describe("document updates", () => {
  it("compose concurrent patches instead of losing one", async () => {
    await useApp.getState().init();
    const doc = await useApp.getState().createDocument();
    await Promise.all([
      useApp.getState().updateDocument(doc.id, { title: "Kept title" }),
      useApp.getState().updateDocument(doc.id, { wordCount: 42 }),
    ]);
    expect(useApp.getState().documents.find((d) => d.id === doc.id)).toMatchObject({
      title: "Kept title",
      wordCount: 42,
    });
    expect(await useApp.getState().repo.getDocument(doc.id)).toMatchObject({
      title: "Kept title",
      wordCount: 42,
    });
  });
});
