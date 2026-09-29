import { useSyncExternalStore } from "react";

/** Minimal history-API router. Routes: `/`, `/d/:id`, and screen paths added by later features. */
export type Route =
  | { name: "home" }
  | { name: "doc"; id: string; split?: string }
  | { name: "history"; id: string }
  | { name: "voice"; id: string }
  | { name: "screen"; path: string };

export function parseRoute(pathname: string, search = ""): Route {
  const history = /^\/d\/([^/]+)\/history\/?$/.exec(pathname);
  if (history) return { name: "history", id: decodeURIComponent(history[1]!) };
  const voice = /^\/d\/([^/]+)\/voice\/?$/.exec(pathname);
  if (voice) return { name: "voice", id: decodeURIComponent(voice[1]!) };
  const doc = /^\/d\/([^/]+)\/?$/.exec(pathname);
  if (doc) {
    const split = new URLSearchParams(search).get("split");
    return { name: "doc", id: decodeURIComponent(doc[1]!), ...(split ? { split } : {}) };
  }
  if (pathname === "/" || pathname === "") return { name: "home" };
  return { name: "screen", path: pathname };
}

const listeners = new Set<() => void>();

let current = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";

function onPopState() {
  const next = window.location.pathname + window.location.search;
  if (next !== current && !mayLeave()) {
    // Undo the browser's back/forward step and stay on the page with unsaved changes.
    window.history.pushState(null, "", current);
    return;
  }
  leaveGuard = null;
  current = next;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") window.addEventListener("popstate", onPopState);

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A page with unsaved changes can ask before the user navigates away. */
let leaveGuard: (() => string | null) | null = null;

export function setLeaveGuard(guard: (() => string | null) | null): void {
  leaveGuard = guard;
}

function mayLeave(): boolean {
  const message = leaveGuard?.();
  return !message || window.confirm(message);
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (path === window.location.pathname + window.location.search) return;
  if (!mayLeave()) return;
  leaveGuard = null;
  if (opts.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  current = path;
  listeners.forEach((l) => l());
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);
}

export function useRoute(): Route {
  const loc = useLocation();
  const q = loc.indexOf("?");
  return q === -1 ? parseRoute(loc) : parseRoute(loc.slice(0, q), loc.slice(q));
}

export const docPath = (id: string) => `/d/${encodeURIComponent(id)}`;

export const historyPath = (id: string) => `${docPath(id)}/history`;
export const voicePath = (id: string) => `${docPath(id)}/voice`;

export const splitPath = (id: string, splitId: string) =>
  `${docPath(id)}?split=${encodeURIComponent(splitId)}`;
