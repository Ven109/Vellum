import * as Y from "yjs";

/**
 * Server-side HTML for a document's Y.Doc, used by public read-only links. It maps the editor's node and
 * mark names directly, so it needs no editor code. Pending suggestions show the text as it was before
 * them (insertions hidden, deletions kept) and comments are not rendered.
 */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const safeUrl = (url: unknown): string | null => {
  if (typeof url !== "string") return null;
  return /^(https?:|mailto:|data:image\/(png|jpe?g|gif|webp|avif);)/i.test(url.trim()) ? url.trim() : null;
};

type Attrs = Record<string, unknown>;

function renderText(text: Y.XmlText): string {
  let out = "";
  for (const op of text.toDelta() as Array<{ insert: unknown; attributes?: Attrs }>) {
    if (typeof op.insert !== "string") continue;
    const a = op.attributes ?? {};
    if (a.suggestionInsert) continue;
    let html = esc(op.insert);
    if (a.code) html = `<code>${html}</code>`;
    if (a.bold) html = `<strong>${html}</strong>`;
    if (a.italic) html = `<em>${html}</em>`;
    if (a.strike) html = `<s>${html}</s>`;
    if (a.underline) html = `<u>${html}</u>`;
    const link = a.link as { href?: unknown } | undefined;
    const href = link && safeUrl(link.href);
    if (href) html = `<a href="${esc(href)}" rel="noopener nofollow">${html}</a>`;
    out += html;
  }
  return out;
}

function renderChildren(parent: Y.XmlFragment | Y.XmlElement): string {
  return parent
    .toArray()
    .map((c) => (c instanceof Y.XmlText ? renderText(c) : c instanceof Y.XmlElement ? renderElement(c) : ""))
    .join("");
}

function renderElement(el: Y.XmlElement): string {
  const attrs = el.getAttributes() as Attrs;
  const inner = () => renderChildren(el);
  switch (el.nodeName) {
    case "paragraph":
      return `<p>${inner()}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(attrs.level) || 2));
      return `<h${level}>${inner()}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${inner()}</blockquote>`;
    case "bulletList":
      return `<ul>${inner()}</ul>`;
    case "orderedList": {
      const start = Number(attrs.start) || 1;
      return start === 1 ? `<ol>${inner()}</ol>` : `<ol start="${start}">${inner()}</ol>`;
    }
    case "listItem":
      return `<li>${inner()}</li>`;
    case "codeBlock":
      return `<pre><code>${inner()}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "hardBreak":
      return "<br>";
    case "image": {
      const src = safeUrl(attrs.src);
      return src ? `<img src="${esc(src)}" alt="${esc(String(attrs.alt ?? ""))}">` : "";
    }
    default:
      return inner();
  }
}

export function renderDocument(doc: Y.Doc): { title: string; html: string } {
  return { title: doc.getText("title").toString(), html: renderChildren(doc.getXmlFragment("content")) };
}

export function publicPage(title: string, bodyHtml: string): string {
  const t = esc(title || "Untitled");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<style>
  :root { color-scheme: light dark; --paper: #fdfbf7; --ink: #1f1a14; --muted: #8a8174; --accent: #9a3412; --line: #e4dccd; }
  @media (prefers-color-scheme: dark) { :root { --paper: #171512; --ink: #eee7dc; --muted: #8f877b; --accent: #f08a5d; --line: #342f28; } }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 19px/1.7 "Iowan Old Style", Palatino, Georgia, serif; }
  main { max-width: 68ch; margin: 0 auto; padding: 64px 20px 96px; }
  h1 { font-size: 2.1em; line-height: 1.2; margin: 0 0 1em; }
  a { color: var(--accent); }
  img { max-width: 100%; height: auto; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid var(--line); color: var(--muted); }
  pre { overflow: auto; padding: 12px; background: color-mix(in srgb, var(--ink) 6%, transparent); border-radius: 8px; font-size: 15px; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
  footer { margin-top: 64px; color: var(--muted); font: 13px/1.5 system-ui, sans-serif; }
</style>
</head>
<body>
<main>
<article>
<h1>${t}</h1>
${bodyHtml}
</article>
<footer>Published with Vellum</footer>
</main>
</body>
</html>`;
}
