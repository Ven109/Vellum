import type { Editor } from "@tiptap/core";
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { captureContext, createId, parseMentions, reanchor } from "@vellum/core";
import type { Comment, CommentThread, TextAnchor } from "@vellum/core";
import { docTextMap } from "@vellum/editor";
import * as Y from "yjs";
import { sync } from "@vellum/core";

/**
 * Comment threads live in the document's Y.Doc (map "threads"), so they sync, work offline and travel
 * with the document. Anchors are Yjs relative positions — they survive edits around them and remote
 * edits — plus a quote with context used to re-anchor if the passage moves, and to mark the thread
 * orphaned (kept, shown detached) if it is deleted.
 */
export function threadsOf(doc: Y.Doc): Y.Map<CommentThread> {
  return doc.getMap<CommentThread>("threads");
}

type Mapping = Parameters<typeof relativePositionToAbsolutePosition>[3];

function binding(editor: Editor): { fragment: Y.XmlFragment; mapping: Mapping; doc: Y.Doc } | null {
  const state = ySyncPluginKey.getState(editor.state) as
    { binding?: { type: Y.XmlFragment; mapping: Mapping; doc: Y.Doc } } | undefined;
  const b = state?.binding;
  return b ? { fragment: b.type, mapping: b.mapping, doc: b.doc } : null;
}

export function anchorForRange(editor: Editor, from: number, to: number): TextAnchor | null {
  const b = binding(editor);
  if (!b || from >= to) return null;
  const encode = (pos: number) =>
    sync.toBase64(
      Y.encodeRelativePosition(
        absolutePositionToRelativePosition(pos, b.fragment, b.mapping) as Y.RelativePosition,
      ),
    );
  const map = docTextMap(editor.state.doc);
  const ctx = captureContext(map.text, map.offsetAt(from), map.offsetAt(to));
  return { start: encode(from), end: encode(to), ...ctx };
}

export type ResolvedAnchor = { from: number; to: number; moved: boolean } | null;

/** Where an anchor is now, re-anchoring by quote if the relative positions collapsed. */
export function resolveAnchor(editor: Editor, anchor: TextAnchor): ResolvedAnchor {
  const b = binding(editor);
  if (!b) return null;
  const decode = (s: string): number | null => {
    try {
      return relativePositionToAbsolutePosition(
        b.doc,
        b.fragment,
        Y.decodeRelativePosition(sync.fromBase64(s)),
        b.mapping,
      );
    } catch {
      // The binding's mapping can briefly lag structural edits; fall back to the quote.
      return null;
    }
  };
  const from = decode(anchor.start);
  const to = decode(anchor.end);
  if (from !== null && to !== null && to > from) {
    const size = editor.state.doc.content.size;
    if (to <= size) {
      const current = editor.state.doc.textBetween(from, to, "\n\n", " ");
      if (current.trim().length > 0) return { from, to, moved: false };
    }
  }
  const map = docTextMap(editor.state.doc);
  const found = reanchor(map.text, anchor);
  if (!found) return null;
  return { from: map.posAt(found.start), to: map.posAt(found.end), moved: true };
}

export interface Person {
  id: string;
  name: string;
}

export function createThread(
  doc: Y.Doc,
  anchor: TextAnchor,
  author: Person,
  body: string,
  people: Person[],
): CommentThread {
  const now = new Date().toISOString();
  const thread: CommentThread = {
    id: createId("thr"),
    documentId: doc.guid,
    anchor,
    status: "open",
    orphaned: false,
    comments: [makeComment(author, body, people, now)],
  };
  threadsOf(doc).set(thread.id, thread);
  return thread;
}

function makeComment(author: Person, body: string, people: Person[], at: string): Comment {
  return {
    id: createId("cmt"),
    authorId: author.id,
    authorName: author.name,
    body: body.trim(),
    mentions: parseMentions(body, people),
    createdAt: at,
  };
}

function update(doc: Y.Doc, id: string, fn: (t: CommentThread) => CommentThread) {
  const map = threadsOf(doc);
  const t = map.get(id);
  if (t) map.set(id, fn(t));
}

export function reply(doc: Y.Doc, threadId: string, author: Person, body: string, people: Person[]) {
  update(doc, threadId, (t) => ({
    ...t,
    comments: [...t.comments, makeComment(author, body, people, new Date().toISOString())],
  }));
}

export function editComment(doc: Y.Doc, threadId: string, commentId: string, body: string, people: Person[]) {
  update(doc, threadId, (t) => ({
    ...t,
    comments: t.comments.map((c) =>
      c.id === commentId
        ? {
            ...c,
            body: body.trim(),
            mentions: parseMentions(body, people),
            editedAt: new Date().toISOString(),
          }
        : c,
    ),
  }));
}

export function setResolved(doc: Y.Doc, threadId: string, resolved: boolean, by: Person) {
  update(doc, threadId, (t) =>
    resolved
      ? { ...t, status: "resolved", resolvedBy: by.id, resolvedAt: new Date().toISOString() }
      : { ...t, status: "open", resolvedBy: undefined, resolvedAt: undefined },
  );
}

export function deleteThread(doc: Y.Doc, threadId: string) {
  threadsOf(doc).delete(threadId);
}

/** Persist a re-anchored position or orphaned state so every client agrees. */
export function saveAnchorState(editor: Editor, doc: Y.Doc, thread: CommentThread, resolved: ResolvedAnchor) {
  if (!resolved) {
    if (!thread.orphaned) update(doc, thread.id, (t) => ({ ...t, orphaned: true }));
    return;
  }
  if (resolved.moved || thread.orphaned) {
    const anchor = anchorForRange(editor, resolved.from, resolved.to);
    if (anchor) update(doc, thread.id, (t) => ({ ...t, anchor, orphaned: false }));
  }
}
