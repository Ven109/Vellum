import type { Editor } from "@tiptap/core";
import { create } from "zustand";

export interface HeadingEntry {
  level: number;
  text: string;
  pos: number;
}

/** Live state of the document currently open in the editor, shared by the top bar and right rail. */
export interface DocSessionState {
  docId: string | null;
  editor: Editor | null;
  wordCount: number;
  openedWordCount: number;
  openedAt: number;
  headings: HeadingEntry[];
  saveState: "saved" | "saving" | "offline" | "error";
  open(docId: string, editor: Editor, wordCount: number): void;
  close(docId: string): void;
  update(patch: Partial<Pick<DocSessionState, "wordCount" | "headings" | "saveState">>): void;
}

export const useDocSession = create<DocSessionState>((set, get) => ({
  docId: null,
  editor: null,
  wordCount: 0,
  openedWordCount: 0,
  openedAt: 0,
  headings: [],
  saveState: "saved",
  open(docId, editor, wordCount) {
    set({ docId, editor, wordCount, openedWordCount: wordCount, openedAt: Date.now(), headings: [] });
  },
  close(docId) {
    if (get().docId === docId) set({ docId: null, editor: null, headings: [] });
  },
  update(patch) {
    set(patch);
  },
}));
