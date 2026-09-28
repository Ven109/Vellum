import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { IndexedDbRepository } from "../src/data/idb.js";
import { useApp } from "../src/state/app.js";
import { useCommands } from "../src/state/commands.js";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/library");
  useCommands.setState({ paletteOpen: false });
  useApp.setState({ repo: new IndexedDbRepository(`test-${Math.random()}`), ready: false, documents: [] });
});

async function openPalette() {
  render(<App />);
  await screen.findByRole("heading", { name: "Library" });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.findByRole("dialog", { name: "Command palette" });
}

describe("command palette", () => {
  it("opens with Ctrl+K and finds documents fuzzily", async () => {
    await useApp.getState().init();
    const dialog = await openPalette();
    await act(async () => {
      await useApp.getState().createDocument({ title: "The quiet tool" });
    });
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "qtool" } });
    const option = await within(dialog).findByRole("option", { name: /The quiet tool/ });
    expect(option.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/d\//));
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("filters to commands with > and runs them", async () => {
    const dialog = await openPalette();
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: ">theme" } });
    expect(within(dialog).queryByRole("group", { name: "Documents" })).toBeNull();
    expect(within(dialog).getByRole("option", { name: /Toggle theme/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("creates a draft when nothing matches", async () => {
    const dialog = await openPalette();
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "Brand new idea" } });
    expect(within(dialog).getByRole("option", { name: /Create draft “Brand new idea”/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() =>
      expect(useApp.getState().documents.some((d) => d.title === "Brand new idea")).toBe(true),
    );
  });

  it("closes on Escape", async () => {
    const dialog = await openPalette();
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });
});
