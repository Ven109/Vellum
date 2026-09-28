/**
 * Detects whether this web app is talking to a Vellum server. With no server (e.g. the static build
 * opened from disk, or a server that is down at startup) the app runs local-only and syncs later.
 */
let detected: Promise<boolean> | null = null;

export function serverBaseUrl(): string {
  return (import.meta.env.VITE_VELLUM_SERVER as string | undefined) ?? window.location.origin;
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

export function syncUrl(docId: string): string {
  const base = new URL(serverBaseUrl());
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `/sync/${encodeURIComponent(docId)}`;
  return base.toString();
}
