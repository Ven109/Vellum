export const REPO = "Ven109/Vellum";
export const REPO_URL = `https://github.com/${REPO}`;

/** 950 → "950", 1234 → "1.2k", 12_345 → "12k", 1_250_000 → "1.3M". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? Math.round(k * 10) / 10 : Math.round(k)}k`.replace(".0k", "k");
  }
  const m = n / 1_000_000;
  return `${m < 10 ? Math.round(m * 10) / 10 : Math.round(m)}M`.replace(".0M", "M");
}

const CACHE_KEY = "vellum-site:stars";
const CACHE_MS = 60 * 60 * 1000;

/** The repository's star count, cached for an hour; null when GitHub can't be reached or rate-limits us. */
export async function fetchStars(fetcher: typeof fetch = fetch): Promise<number | null> {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null") as {
      n: number;
      at: number;
    } | null;
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.n;
  } catch {
    /* no storage */
  }
  try {
    const res = await fetcher(`https://api.github.com/repos/${REPO}`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const n = ((await res.json()) as { stargazers_count?: unknown }).stargazers_count;
    if (typeof n !== "number") return null;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ n, at: Date.now() }));
    } catch {
      /* no storage */
    }
    return n;
  } catch {
    return null;
  }
}
