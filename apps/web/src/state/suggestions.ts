import type { Editor } from "@tiptap/core";
import type { ShareRole } from "@vellum/core";
import { docToMarkdown, listSuggestions } from "@vellum/editor";
import { recordVersion } from "../data/versions.js";
import { useDocSession } from "./session.js";
import type { SuggestionInfo } from "@vellum/editor";
import { useEffect } from "react";
import { create } from "zustand";
import { me } from "./comments.js";

interface SuggestionsState {
  mode: "editing" | "suggesting";
  items: SuggestionInfo[];
  /** The current user's access to the open document. */
  role: ShareRole | "owner";
  setMode(mode: "editing" | "suggesting"): void;
}

export const useSuggestions = create<SuggestionsState>((set) => ({
  mode: "editing",
  items: [],
  role: "owner",
  setMode(mode) {
    set({ mode });
  },
}));

/** Reviewers default to suggesting mode so nobody rewrites a draft by accident. */
export function defaultModeFor(role: ShareRole | "owner"): "editing" | "suggesting" {
  return role === "owner" || role === "edit" ? "editing" : "suggesting";
}

export function canEdit(role: ShareRole | "owner"): boolean {
  return role === "owner" || role === "edit";
}

export function canSuggest(role: ShareRole | "owner"): boolean {
  return role !== "view" && role !== "comment";
}

export function useSuggestionsBinding(editor: Editor | null, enabled: boolean) {
  const mode = useSuggestions((s) => s.mode);
  const role = useSuggestions((s) => s.role);

  useEffect(() => {
    if (!editor || !enabled) return;
    useSuggestions.setState({ mode: defaultModeFor(role) });
  }, [editor, enabled, role]);

  useEffect(() => {
    if (!editor || !enabled) return;
    const forced = !canEdit(role);
    editor.commands.setSuggesting(mode === "suggesting" || forced, me());
    editor.setEditable(canSuggest(role));
  }, [editor, enabled, mode, role]);

  useEffect(() => {
    if (!editor || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => useSuggestions.setState({ items: listSuggestions(editor.state.doc) });
    refresh();
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 100);
    };
    editor.on("update", onUpdate);
    return () => {
      clearTimeout(timer);
      editor.off("update", onUpdate);
      useSuggestions.setState({ items: [] });
    };
  }, [editor, enabled]);
}

/**
 * Accept suggestions and record the result as a version attributed to the suggestion's author and the
 * person who accepted it, so reviewers' changes are visible in history.
 */
export function acceptWithHistory(editor: Editor, items: SuggestionInfo[]): void {
  if (!items.length) return;
  editor.commands.acceptSuggestions(items.map((s) => s.id));
  const docId = useDocSession.getState().docId;
  if (!docId) return;
  const authors = [...new Set(items.map((s) => s.authorId).filter(Boolean))];
  void recordVersion(
    docId,
    docToMarkdown(editor.state.doc),
    {
      kind: "suggestion",
      suggestionId: items.map((s) => s.id).join(","),
      suggestedBy: authors.join(",") || "unknown",
      acceptedBy: me().id,
    },
    "suggestion",
  ).catch(() => undefined);
}
