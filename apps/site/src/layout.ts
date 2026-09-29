/** The header and footer shared by every generated page (index.html carries its own copy). */

const GITHUB_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export const NAV_LINKS: Array<{ href: string; label: string; section: string }> = [
  { href: "/#features", label: "Features", section: "home" },
  { href: "/#pricing", label: "Pricing", section: "home" },
  { href: "/docs/", label: "Docs", section: "docs" },
  { href: "/download/", label: "Download", section: "download" },
];

export function header(section: string): string {
  const links = NAV_LINKS.map(
    (l) => `<a href="${l.href}"${l.section === section ? ' aria-current="page"' : ""}>${l.label}</a>`,
  ).join("\n          ");
  return `<a class="skip" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="wrap header-row">
        <a class="brand" href="/" aria-label="Vellum home"><img src="/favicon.svg" alt="" width="24" height="24" /><span>Vellum</span></a>
        <button class="menu-btn" type="button" data-menu aria-expanded="false" aria-controls="site-nav">Menu</button>
        <nav id="site-nav" class="site-nav" aria-label="Site">
          ${links}
          <a class="gh" href="https://github.com/Ven109/Vellum" aria-label="Vellum on GitHub">${GITHUB_ICON}<span>GitHub</span><span class="stars" data-stars hidden></span></a>
        </nav>
      </div>
    </header>`;
}

export const FOOTER = `<footer class="site-footer">
      <div class="wrap footer-grid">
        <div>
          <a class="brand" href="/"><img src="/favicon.svg" alt="" width="20" height="20" /><span>Vellum</span></a>
          <p class="muted">Open-source writing, on your own terms.</p>
        </div>
        <nav aria-label="Product">
          <h2>Product</h2>
          <a href="/#features">Features</a>
          <a href="/#pricing">Pricing</a>
          <a href="/download/">Download</a>
          <a href="/changelog/">Changelog</a>
        </nav>
        <nav aria-label="Documentation">
          <h2>Docs</h2>
          <a href="/docs/self-hosting/">Self-hosting</a>
          <a href="/docs/ai-providers/">AI providers</a>
          <a href="/docs/contributing/">Contributing</a>
        </nav>
        <nav aria-label="Community">
          <h2>Community</h2>
          <a href="https://github.com/Ven109/Vellum">GitHub</a>
          <a href="https://github.com/Ven109/Vellum/issues">Issues</a>
          <a href="https://github.com/Ven109/Vellum/blob/main/LICENSE">License (AGPL-3.0)</a>
        </nav>
      </div>
      <p class="wrap muted copyright">© <span data-year>2026</span> Vellum contributors.</p>
    </footer>`;

export function page(opts: {
  title: string;
  description: string;
  section: string;
  body: string;
  script?: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(opts.title)}</title>
    <meta name="description" content="${esc(opts.description)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <script type="module" src="/src/main.ts"></script>${opts.script ? `\n    <script type="module" src="${opts.script}"></script>` : ""}
  </head>
  <body>
    ${header(opts.section)}
    <main id="main">
${opts.body}
    </main>
    ${FOOTER}
  </body>
</html>
`;
}
