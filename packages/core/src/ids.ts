const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lower-case

/**
 * Create a time-sortable, URL-safe identifier with a type prefix, e.g. `doc_01j9x3...`.
 * 10 characters of millisecond timestamp followed by 16 random characters.
 */
export function createId(prefix: IdPrefix, now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % 32];
  return `${prefix}_${time}${rand}`;
}

export type IdPrefix =
  | "usr"
  | "wsp"
  | "col"
  | "doc"
  | "ver"
  | "thr"
  | "cmt"
  | "sug"
  | "shr"
  | "ses"
  | "inv"
  | "key"
  | "vss"
  | "trn";

export function idPrefix(id: string): string | undefined {
  const i = id.indexOf("_");
  return i > 0 ? id.slice(0, i) : undefined;
}
