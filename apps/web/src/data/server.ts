/**
 * Detects whether this web app is talking to a Vellum server. With no server (e.g. the static build
 * opened from disk, or a server that is down at startup) the app runs local-only and syncs later.
 */
let detected: Promise<boolean> | null = null;

const SERVER_KEY = "vellum:server-url";
const TOKEN_KEY = "vellum:session-token";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/**
 * The server this app syncs with. The web app talks to the server it was loaded from; the desktop app
 * (and a web build opened elsewhere) uses the server the writer connected to in Settings, if any.
 */
export function serverBaseUrl(): string {
  return (
    stored(SERVER_KEY) ?? (import.meta.env.VITE_VELLUM_SERVER as string | undefined) ?? window.location.origin
  );
}

/** True when the server is on another origin, so sign-in uses a bearer token instead of a cookie. */
export function isCrossOrigin(): boolean {
  try {
    return new URL(serverBaseUrl()).origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function configuredServer(): string | null {
  return stored(SERVER_KEY);
}

/** Connect to a Vellum server (or disconnect with null). Signs out of the previous one. */
export function setConfiguredServer(url: string | null): void {
  store(SERVER_KEY, url ? url.replace(/\/+$/, "") : null);
  store(TOKEN_KEY, null);
  detected = null;
}

export function sessionToken(): string | null {
  return isCrossOrigin() ? stored(TOKEN_KEY) : null;
}

export function setSessionToken(token: string | null): void {
  store(TOKEN_KEY, token);
}

/** Headers that authenticate requests to a server on another origin. */
export function authHeaders(): Record<string, string> {
  const token = sessionToken();
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(isCrossOrigin() ? { "x-vellum-token": "1" } : {}),
  };
}

export function detectServer(timeoutMs = 2000): Promise<boolean> {
  detected ??= (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`${serverBaseUrl()}/api/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const body = (await res.json()) as { name?: string };
      return body.name === "vellum";
    } catch {
      return false;
    }
  })();
  return detected;
}

export function resetServerDetection(): void {
  detected = null;
}

export function syncUrl(docId: string, workspaceId?: string): string {
  const base = new URL(serverBaseUrl());
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `/sync/${encodeURIComponent(docId)}`;
  if (workspaceId) base.searchParams.set("ws", workspaceId);
  const token = sessionToken();
  if (token) base.searchParams.set("access_token", token);
  return base.toString();
}

type WorkspaceResolver = (docId: string) => string | null;
let resolver: WorkspaceResolver = () => null;

/**
 * Which server workspace a document syncs under, or null to keep it on this device only (signed out,
 * or a local-only workspace). The server checks membership; the id registers new documents.
 */
export function setSyncWorkspaceResolver(fn: WorkspaceResolver): void {
  resolver = fn;
}

export function syncWorkspaceFor(docId: string): string | null {
  return resolver(docId);
}
