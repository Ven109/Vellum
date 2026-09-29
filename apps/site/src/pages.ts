import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { page } from "./layout.js";
import { renderMarkdown, titleOf } from "./markdown.js";

/**
 * Build-time page generation (called from vite.config.ts): the docs are rendered from the repository's
 * Markdown, so the site and the repo never disagree; the download and changelog pages share the layout
 * and load their data from GitHub Releases in the browser.
 */
export const REPO_BLOB = "https://github.com/Ven109/Vellum/blob/main";

export interface DocPage {
  slug: string;
  /** Path from the repository root. */
  file: string;
  group: string;
  title?: string;
}

export const DOCS: DocPage[] = [
  { slug: "self-hosting", file: "docs/self-hosting.md", group: "Run Vellum" },
  { slug: "accounts", file: "docs/accounts.md", group: "Run Vellum" },
  { slug: "desktop", file: "docs/desktop.md", group: "Run Vellum" },
  { slug: "ai-providers", file: "docs/ai-providers.md", group: "Write with AI" },
  { slug: "voice", file: "docs/voice.md", group: "Write with AI" },
  { slug: "document-format", file: "docs/data-model.md", group: "Your data", title: "Document format" },
  { slug: "contributing", file: "CONTRIBUTING.md", group: "Contribute" },
  { slug: "releasing", file: "docs/releasing.md", group: "Contribute" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Where a link in a repository Markdown file points on the site (or on GitHub, for other files). */
export function rewriteDocLink(href: string, fromFile: string): string {
  const [path = "", hash] = href.split("#");
  const anchor = hash ? `#${hash}` : "";
  if (!path) return anchor;
  const resolved = posix.normalize(posix.join(posix.dirname(fromFile), path));
  const doc = DOCS.find((d) => d.file === resolved);
  if (doc) return `/docs/${doc.slug}/${anchor}`;
  return `${REPO_BLOB}/${resolved}${anchor}`;
}

/** The first paragraph after the title, as plain text, for descriptions. */
export function summaryOf(source: string): string {
  const para = source
    .replace(/^#.*$/m, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("```"));
  return (para ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function docsNav(current: string | null): string {
  const groups = [...new Set(DOCS.map((d) => d.group))];
  return `<nav class="docs-nav" aria-label="Docs pages">
        <a href="/docs/"${current === null ? ' aria-current="page"' : ""}>Overview</a>
        ${groups
          .map(
            (g) => `<h2>${esc(g)}</h2>
        ${DOCS.filter((d) => d.group === g)
          .map(
            (d) =>
              `<a href="/docs/${d.slug}/"${d.slug === current ? ' aria-current="page"' : ""}>${esc(d.title ?? "")}</a>`,
          )
          .join("\n        ")}`,
          )
          .join("\n        ")}
      </nav>`;
}

function write(file: string, html: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const GENERATED = ["docs", "download", "changelog"];

/** Write every generated page under `siteRoot` and return their paths (Vite build inputs). */
export function generatePages(siteRoot: string, repoRoot: string): string[] {
  for (const dir of GENERATED) rmSync(join(siteRoot, dir), { recursive: true, force: true });
  const out: string[] = [];
  const sources = new Map<string, string>();
  for (const d of DOCS) {
    const md = readFileSync(join(repoRoot, d.file), "utf8");
    sources.set(d.slug, md);
    d.title ??= titleOf(md);
  }

  for (const d of DOCS) {
    const md = sources.get(d.slug)!;
    const html = renderMarkdown(md, { rewriteLink: (href) => rewriteDocLink(href, d.file) });
    const file = join(siteRoot, "docs", d.slug, "index.html");
    write(
      file,
      page({
        title: `${d.title} — Vellum docs`,
        description: summaryOf(md),
        section: "docs",
        body: `      <div class="wrap docs-layout">
      ${docsNav(d.slug)}
      <article class="prose">
${html}
        <p class="edit-link"><a href="${REPO_BLOB}/${d.file}">Edit this page on GitHub</a></p>
      </article>
      </div>`,
      }),
    );
    out.push(file);
  }

  const index = join(siteRoot, "docs", "index.html");
  write(
    index,
    page({
      title: "Documentation — Vellum",
      description: "Self-hosting, AI providers, the document format and contributing to Vellum.",
      section: "docs",
      body: `      <div class="wrap docs-layout">
      ${docsNav(null)}
      <article class="prose">
        <h1>Documentation</h1>
        <p class="lede">Everything you need to run Vellum, connect your own AI provider, and understand where your writing lives.</p>
        <ul class="doc-cards">
          ${DOCS.map(
            (d) =>
              `<li><a href="/docs/${d.slug}/"><strong>${esc(d.title!)}</strong><span>${esc(summaryOf(sources.get(d.slug)!))}</span></a></li>`,
          ).join("\n          ")}
        </ul>
      </article>
      </div>`,
    }),
  );
  out.push(index);

  const download = join(siteRoot, "download", "index.html");
  write(
    download,
    page({
      title: "Download Vellum",
      description: "Signed Vellum builds for macOS, Windows and Linux, with SHA-256 checksums.",
      section: "download",
      script: "/src/download.ts",
      body: `      <section class="wrap download" aria-labelledby="dl-title">
        <h1 id="dl-title">Download Vellum</h1>
        <p class="lede">The desktop app works on its own, offline, and can connect to any Vellum server. Free, open source, and signed.</p>
        <div class="dl-primary" data-primary aria-live="polite">
          <p class="muted">Finding the latest release…</p>
        </div>
        <section aria-labelledby="all-title">
          <h2 id="all-title">All downloads</h2>
          <div data-assets><p class="muted">Loading…</p></div>
        </section>
        <section class="verify" aria-labelledby="verify-title">
          <h2 id="verify-title">Check your download</h2>
          <p>Each file's SHA-256 checksum is listed above and in <span data-sums>SHA256SUMS.txt</span> on the release. Compare it with:</p>
          <pre><code>shasum -a 256 Vellum-*.dmg          # macOS
sha256sum Vellum-*.AppImage         # Linux
Get-FileHash .\\Vellum-*.exe         # Windows (PowerShell)</code></pre>
          <p>macOS builds are notarised by Apple and Windows installers are code-signed, so your system can verify them too.</p>
        </section>
        <p class="muted">Prefer a server for your team? <a href="/docs/self-hosting/">Self-host Vellum</a> with Docker Compose. Looking for what changed? See the <a href="/changelog/">changelog</a>.</p>
      </section>`,
    }),
  );
  out.push(download);

  const changelog = join(siteRoot, "changelog", "index.html");
  write(
    changelog,
    page({
      title: "Changelog — Vellum",
      description: "What's new in each Vellum release.",
      section: "changelog",
      script: "/src/changelog.ts",
      body: `      <section class="wrap changelog" aria-labelledby="cl-title">
        <h1 id="cl-title">Changelog</h1>
        <p class="lede">Every release of Vellum, straight from <a href="https://github.com/Ven109/Vellum/releases">GitHub Releases</a>.</p>
        <div data-releases aria-live="polite"><p class="muted">Loading releases…</p></div>
      </section>`,
    }),
  );
  out.push(changelog);
  return out.map((f) => relative(siteRoot, f));
}
