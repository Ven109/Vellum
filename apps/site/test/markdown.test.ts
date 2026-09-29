import { describe, expect, it } from "vitest";
import { renderMarkdown, slugify, titleOf } from "../src/markdown.js";

describe("renderMarkdown", () => {
  it("renders GitHub-flavoured Markdown with linkable headings", () => {
    const html = renderMarkdown("# Self-hosting Vellum\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```sh\nls\n```");
    expect(html).toContain('<h1 id="self-hosting-vellum">Self-hosting Vellum</h1>');
    expect(html).toContain("<table>");
    expect(html).toContain('<code class="language-sh">ls');
  });

  it("never renders raw HTML or script links", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror="y">',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
  });

  it("rewrites relative links and marks external ones", () => {
    const html = renderMarkdown("[Providers](ai-providers.md#setup) and [Docs](https://example.com)", {
      rewriteLink: (h) => `/docs/${h.replace(".md", "/")}`,
    });
    expect(html).toContain('<a href="/docs/ai-providers/#setup">Providers</a>');
    expect(html).toContain('<a href="https://example.com" rel="noopener">Docs</a>');
  });

  it("prefixes heading ids when asked", () => {
    expect(renderMarkdown("## Fixes", { idPrefix: "v1.2.0-" })).toContain('id="v1.2.0-fixes"');
  });
});

describe("helpers", () => {
  it("slugifies and finds titles", () => {
    expect(slugify("Anthropic & OpenAI: set-up")).toBe("anthropic-openai-set-up");
    expect(titleOf("intro\n# AI providers\n\ntext")).toBe("AI providers");
  });
});
