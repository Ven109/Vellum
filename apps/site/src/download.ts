import {
  PLATFORM_NAMES,
  buildsOf,
  detectPlatform,
  fetchReleases,
  formatSize,
  latestRelease,
  primaryBuild,
  sumsAsset,
} from "./releases.js";
import type { Build, Platform } from "./releases.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

async function visitor(): Promise<{ platform: Platform | null; arm: boolean | null }> {
  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
      getHighEntropyValues?(h: string[]): Promise<{ architecture?: string }>;
    };
  };
  const found = detectPlatform(navigator.userAgent, nav.userAgentData?.platform);
  try {
    const high = await nav.userAgentData?.getHighEntropyValues?.(["architecture"]);
    if (high?.architecture) found.arm = high.architecture === "arm";
  } catch {
    /* not offered */
  }
  return found;
}

function row(b: Build): string {
  return `<tr>
      <td>${PLATFORM_NAMES[b.platform]}</td>
      <td>${esc(b.kind)}${b.arch ? ` · ${esc(b.arch)}` : ""}</td>
      <td><a href="${esc(b.asset.browser_download_url)}">${esc(b.asset.name)}</a></td>
      <td class="num">${formatSize(b.asset.size)}</td>
      <td>${b.sha256 ? `<code class="sha" title="SHA-256">${esc(b.sha256)}</code>` : '<span class="muted">see SHA256SUMS.txt</span>'}</td>
    </tr>`;
}

async function main() {
  const primary = document.querySelector<HTMLElement>("[data-primary]")!;
  const list = document.querySelector<HTMLElement>("[data-assets]")!;
  const releases = await fetchReleases(fetch, 10);
  const release = releases && latestRelease(releases);
  const builds = release ? buildsOf(release) : [];
  if (!release || !builds.length) {
    const why =
      releases === null
        ? "We couldn't reach GitHub to find the latest release."
        : "No desktop release has been published yet.";
    primary.innerHTML = `<p>${why} You'll find every build on <a href="https://github.com/Ven109/Vellum/releases">GitHub Releases</a>, or you can <a href="/docs/desktop/">build it from source</a>.</p>`;
    list.innerHTML = "";
    return;
  }
  const { platform, arm } = await visitor();
  const best = primaryBuild(builds, platform, arm);
  const version = release.tag_name.replace(/^v/, "");
  const date = release.published_at
    ? new Date(release.published_at).toLocaleDateString("en", { dateStyle: "long" })
    : "";
  primary.innerHTML = best
    ? `<a class="btn btn-primary btn-big" href="${esc(best.asset.browser_download_url)}" data-testid="primary-download">Download for ${PLATFORM_NAMES[best.platform]}${best.arch ? ` (${esc(best.arch)})` : ""}</a>
       <p class="muted">Version ${esc(version)}${date ? `, released ${esc(date)}` : ""} · ${formatSize(best.asset.size)} · ${esc(best.kind)}${release.prerelease ? " · pre-release" : ""}</p>
       ${best.sha256 ? `<p class="muted">SHA-256 <code class="sha">${esc(best.sha256)}</code></p>` : ""}`
    : `<p>Vellum ${esc(version)} is available for macOS, Windows and Linux. Pick your download below.</p>`;
  const sums = sumsAsset(release);
  if (sums) {
    const slot = document.querySelector("[data-sums]");
    if (slot) slot.innerHTML = `<a href="${esc(sums.browser_download_url)}">SHA256SUMS.txt</a>`;
  }
  list.innerHTML = `<div class="table-wrap"><table class="dl-table">
    <thead><tr><th>Platform</th><th>Package</th><th>File</th><th class="num">Size</th><th>SHA-256</th></tr></thead>
    <tbody>${builds.map(row).join("")}</tbody>
  </table></div>
  <p class="muted"><a href="${esc(release.html_url)}">Release notes for ${esc(release.name || version)}</a> · <a href="/changelog/">All releases</a></p>`;
}

void main();
