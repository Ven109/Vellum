/* eslint-disable @typescript-eslint/no-explicit-any -- Yjs type internals */
import * as decoding from "lib0/decoding";
import * as Y from "yjs";

/**
 * Which top-level types of `doc` an update would change. Used to enforce read-only and comment-only
 * access: the update is applied to a throwaway copy, never to the real document.
 */
export function changedRoots(doc: Y.Doc, update: Uint8Array): Set<string> {
  const probe = new Y.Doc({ gc: false });
  Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
  const names = new Map<Y.AbstractType<any>, string>();
  const roots = new Set<string>();
  probe.on("afterTransaction", (tr: Y.Transaction) => {
    for (const [name, type] of probe.share) names.set(type, name);
    for (const changed of tr.changed.keys()) {
      let t: Y.AbstractType<any> = changed;
      while (t._item) t = t._item.parent as Y.AbstractType<any>;
      roots.add(names.get(t) ?? "?");
    }
    // Deleting items can leave `changed` empty for types that were removed entirely.
    if (tr.deleteSet.clients.size && roots.size === 0) roots.add("?");
  });
  try {
    Y.applyUpdate(probe, update);
  } finally {
    probe.destroy();
  }
  return roots;
}

/** The update carried by a sync message (step 2 or update), or null for step 1 and other messages. */
export function syncUpdateOf(message: Uint8Array): Uint8Array | null {
  const dec = decoding.createDecoder(message);
  if (decoding.readVarUint(dec) !== 0) return null; // not a sync message
  const kind = decoding.readVarUint(dec);
  if (kind !== 1 && kind !== 2) return null;
  return decoding.readVarUint8Array(dec);
}

export class ReadOnlyError extends Error {}

/** Throws if the message would change anything outside `allowed` (null allows everything). */
export function checkWrite(doc: Y.Doc, message: Uint8Array, allowed: readonly string[] | null): void {
  if (allowed === null) return;
  const update = syncUpdateOf(message);
  if (!update) return;
  for (const root of changedRoots(doc, update)) {
    if (!allowed.includes(root)) throw new ReadOnlyError(`not allowed to change ${root}`);
  }
}
