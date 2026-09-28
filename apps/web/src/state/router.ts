import { useSyncExternalStore } from "react";

/** Minimal history-API router. Routes: `/`, `/d/:id`, and screen paths added by later features. */
export type Route = { name: "home" } | { name: "doc"; id: string } | { name: "screen"; path: string };

export function parseRoute(pathname: string): Route {
  const doc = /^\/d\/([^/]+)\/?$/.exec(pathname);
  if (doc) return { name: "doc", id: decodeURIComponent(doc[1]!) };
  if (pathname === "/" || pathname === "") return { name: "home" };
  return { name: "screen", path: pathname };
}

const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  if (opts.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  listeners.forEach((l) => l());
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function useRoute(): Route {
  return parseRoute(usePathname());
}

export const docPath = (id: string) => `/d/${encodeURIComponent(id)}`;
