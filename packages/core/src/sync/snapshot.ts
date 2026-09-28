import * as Y from "yjs";

/**
 * Helpers for persisting and snapshotting document state. The full document state is a single binary
 * update; versions are either full state (for restore) or a Yjs snapshot (for cheap "what did it look
 * like at time T" views while garbage collection is disabled).
 */
export function encodeState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

export function docFromState(state: Uint8Array, opts: { gc?: boolean } = {}): Y.Doc {
  const doc = new Y.Doc({ gc: opts.gc ?? true });
  Y.applyUpdate(doc, state);
  return doc;
}

/** Merge a sequence of stored incremental updates into one compact update. */
export function compactUpdates(updates: Uint8Array[]): Uint8Array {
  return Y.mergeUpdates(updates);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
