import { REPO } from "./github.js";

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  /** "sha256:<hex>", set by GitHub for release assets. */
  digest?: string | null;
}

export interface Release {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: ReleaseAsset[];
}

export type Platform = "mac" | "windows" | "linux";

export interface Build {
  platform: Platform;
  /** "Apple silicon", "Intel", "x64", "ARM64", "Universal". */
  arch: string;
  /** "Disk image", "Installer", "AppImage", … */
  kind: string;
  asset: ReleaseAsset;
  sha256: string | null;
  /** Lower is offered first. */
  rank: number;
}

export const PLATFORM_NAMES: Record<Platform, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };

/** Which operating system (and CPU, when the browser says) the visitor is on. */
export function detectPlatform(
  userAgent: string,
  uaPlatform?: string,
): { platform: Platform | null; arm: boolean | null } {
  const p = (uaPlatform ?? "").toLowerCase();
  const ua = userAgent.toLowerCase();
  let platform: Platform | null = null;
  // The user-agent string first (it's what the browser presents), then the client hint.
  if (/iphone|ipad|android/.test(ua)) platform = null;
  else if (/mac os x|macintosh/.test(ua)) platform = "mac";
  else if (ua.includes("windows")) platform = "windows";
  else if (/linux|x11|cros/.test(ua)) platform = "linux";
  else if (p.includes("mac")) platform = "mac";
  else if (p.includes("win")) platform = "windows";
  else if (p.includes("linux")) platform = "linux";
  const arm = /aarch64|arm64/.test(ua) ? true : null;
  return { platform, arm };
}

function archOf(name: string): string {
  if (/universal/i.test(name)) return "Universal";
  if (/arm64|aarch64/i.test(name)) return "ARM64";
  if (/x64|x86_64|amd64/i.test(name)) return "x64";
  if (/armv7l/i.test(name)) return "ARMv7";
  return "";
}

/** Recognise an installer from its file name (electron-builder's Vellum-<version>-<os>-<arch>.<ext>). */
export function classifyAsset(asset: ReleaseAsset): Build | null {
  const name = asset.name;
  if (/\.blockmap$|\.ya?ml$|sha256sums/i.test(name)) return null;
  const sha256 = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null;
  const arch = archOf(name);
  const make = (platform: Platform, kind: string, rank: number, archLabel = arch): Build => ({
    platform,
    arch: archLabel,
    kind,
    asset,
    sha256,
    rank,
  });
  if (/\.dmg$/i.test(name)) {
    const label = arch === "ARM64" ? "Apple silicon" : arch === "x64" ? "Intel" : arch;
    return make("mac", "Disk image", arch === "Universal" ? 0 : arch === "ARM64" ? 1 : 2, label);
  }
  if (/mac.*\.zip$/i.test(name)) {
    const label = arch === "ARM64" ? "Apple silicon" : arch === "x64" ? "Intel" : arch;
    return make("mac", "Zip", 5, label);
  }
  if (/\.exe$/i.test(name)) return make("windows", "Installer", arch === "ARM64" ? 1 : 0);
  if (/\.msi$/i.test(name)) return make("windows", "MSI installer", 2);
  if (/\.appimage$/i.test(name)) return make("linux", "AppImage", arch === "ARM64" ? 1 : 0);
  if (/\.deb$/i.test(name)) return make("linux", "Debian/Ubuntu (.deb)", 2);
  if (/\.rpm$/i.test(name)) return make("linux", "Fedora (.rpm)", 3);
  if (/\.flatpak$/i.test(name)) return make("linux", "Flatpak", 4);
  return null;
}

export function buildsOf(release: Release): Build[] {
  const order: Platform[] = ["mac", "windows", "linux"];
  return release.assets
    .map(classifyAsset)
    .filter((b): b is Build => b !== null)
    .sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform) || a.rank - b.rank);
}

/** The build to offer first for this visitor. */
export function primaryBuild(builds: Build[], platform: Platform | null, arm: boolean | null): Build | null {
  if (!platform) return null;
  const mine = builds.filter((b) => b.platform === platform);
  if (arm !== null) {
    const matching = mine.filter((b) =>
      arm ? /ARM64|Apple silicon|Universal/.test(b.arch) : !/ARM64|Apple silicon/.test(b.arch),
    );
    if (matching.length) return matching[0]!;
  }
  return mine[0] ?? null;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function sumsAsset(release: Release): ReleaseAsset | undefined {
  return release.assets.find((a) => /sha256sums/i.test(a.name));
}

export async function fetchReleases(fetcher: typeof fetch = fetch, perPage = 30): Promise<Release[] | null> {
  try {
    const res = await fetcher(`https://api.github.com/repos/${REPO}/releases?per_page=${perPage}`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const list = (await res.json()) as Release[];
    return Array.isArray(list) ? list.filter((r) => !r.draft) : null;
  } catch {
    return null;
  }
}

/** The newest stable release (falling back to the newest pre-release when there's no stable one). */
export function latestRelease(releases: Release[]): Release | null {
  return releases.find((r) => !r.prerelease) ?? releases[0] ?? null;
}
