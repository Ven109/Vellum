import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { IndexedDbRepository } from "../src/data/idb.js";
import { useApp } from "../src/state/app.js";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  useApp.setState({ repo: new IndexedDbRepository(`test-${Math.random()}`), ready: false, documents: [] });
});

describe("editor screen", () => {
  it("seeds a workspace and opens the welcome draft", async () => {
    render(<App />);
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
    await screen.findByDisplayValue("Welcome to Vellum");
    const before = window.location.pathname;
    await act(async () => screen.getByRole("button", { name: /New draft/ }).click());
    await waitFor(() => expect(window.location.pathname).not.toBe(before));
    expect(await screen.findByPlaceholderText("Untitled")).toBeTruthy();
    expect(screen.getAllByText("Untitled").length).toBeGreaterThan(0);
  });
});
