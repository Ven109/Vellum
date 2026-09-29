/**
 * vellum:// links back into the app: vellum://d/<document id> (also vellum://open/d/<id>) opens that
 * document; vellum://new starts a new draft.
 */
export type DeepLink = { type: "open"; path: string } | { type: "new-draft" };

export function parseDeepLink(url: string): DeepLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "vellum:") return null;
  const parts = [u.hostname, ...u.pathname.split("/")].filter(Boolean);
  if (parts[0] === "open") parts.shift();
  if (parts[0] === "new") return { type: "new-draft" };
  if (parts[0] === "d" && parts[1] && /^doc_[0-9a-z]{10,40}$/.test(parts[1]))
    return { type: "open", path: `/d/${parts[1]}` };
  if (parts.length === 0) return { type: "open", path: "/library" };
  return null;
}

export function deepLinkFromArgv(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith("vellum://"));
}
