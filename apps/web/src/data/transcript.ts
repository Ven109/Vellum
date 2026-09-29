import type { Constraint, ConversationState, Turn } from "@vellum/voice";
import * as Y from "yjs";

/**
 * A document's voice transcript lives in the document itself (a `voice` map in its CRDT), so it syncs,
 * works offline and stays with the piece: every turn with its speaker and time, the brief, and the
 * constraints as they stand.
 */
export function voiceOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("voice");
}

function turnsOf(doc: Y.Doc): Y.Array<Turn> {
  const map = voiceOf(doc);
  let arr = map.get("turns") as Y.Array<Turn> | undefined;
  if (!arr) {
    arr = new Y.Array<Turn>();
    map.set("turns", arr);
  }
  return arr;
}

export function loadConversation(doc: Y.Doc): ConversationState {
  const map = voiceOf(doc);
  const turns = (map.get("turns") as Y.Array<Turn> | undefined)?.toArray() ?? [];
  return {
    turns,
    brief: (map.get("brief") as string[] | undefined) ?? [],
    constraints: (map.get("constraints") as Constraint[] | undefined) ?? [],
  };
}

/** Write what changed: new turns are appended (never rewritten), brief and constraints replaced. */
export function saveConversation(doc: Y.Doc, state: ConversationState) {
  doc.transact(() => {
    const map = voiceOf(doc);
    const arr = turnsOf(doc);
    const known = new Set(arr.toArray().map((t) => t.id));
    const fresh = state.turns.filter((t) => !known.has(t.id));
    if (fresh.length) arr.push(fresh.map((t) => ({ ...t })));
    if (JSON.stringify(map.get("brief") ?? []) !== JSON.stringify(state.brief))
      map.set("brief", [...state.brief]);
    if (JSON.stringify(map.get("constraints") ?? []) !== JSON.stringify(state.constraints))
      map.set(
        "constraints",
        state.constraints.map((c) => ({ ...c })),
      );
  }, "voice");
}

/** The turn a paragraph came from, for tracing text back to what was said. */
export function findTurn(doc: Y.Doc, turnId: string): Turn | undefined {
  return (voiceOf(doc).get("turns") as Y.Array<Turn> | undefined)?.toArray().find((t) => t.id === turnId);
}

export function observeConversation(doc: Y.Doc, fn: () => void): () => void {
  const map = voiceOf(doc);
  const handler = () => fn();
  map.observeDeep(handler);
  return () => map.unobserveDeep(handler);
}

/** Forget the conversation (the text written from it stays). */
export function clearConversation(doc: Y.Doc) {
  doc.transact(() => {
    const map = voiceOf(doc);
    for (const k of [...map.keys()]) map.delete(k);
  }, "voice");
}
