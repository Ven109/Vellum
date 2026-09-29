import { Marked } from "marked";
import type { Tokens } from "marked";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface RenderOptions {
  /** Map a link target (e.g. "ai-providers.md#setup") to where it lives on the site. */
  rewriteLink?: (href: string) => string;
  /** Heading levels get ids for deep links; this prefixes them (release notes use the version). */
  idPrefix?: string;
}

/**
 * Markdown to HTML for the docs and release notes. Raw HTML in the source is shown as text, never
 * rendered, and only http(s), mailto, relative and anchor links are kept.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): string {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.text);
      },
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        const id = (options.idPrefix ?? "") + slugify(inner);
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        let href = token.href.trim();
        if (!/^(https?:|mailto:|#|\/|\.{0,2}[\w-])/i.test(href) || /^(javascript|data|vbscript):/i.test(href))
          return inner;
        if (options.rewriteLink && !/^(https?:|mailto:|#)/i.test(href)) href = options.rewriteLink(href);
        const external = /^https?:/i.test(href);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(href)}"${title}${external ? ' rel="noopener"' : ""}>${inner}</a>`;
      },
      image(token: Tokens.Image) {
        // Docs and notes are text; show the alt text rather than hot-linking images.
        return escapeHtml(token.text);
      },
    },
  });
  return marked.parse(source, { async: false }) as string;
}

/** The first "# Title" of a document. */
export function titleOf(source: string): string {
  return /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? "Untitled";
}
