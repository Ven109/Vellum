import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { DOCS, REPO_BLOB, generatePages, rewriteDocLink, summaryOf } from "../src/pages.js";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const out = mkdtempSync(join(tmpdir(), "vellum-site-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("docs links", () => {
  it("point at site pages for docs and at GitHub for everything else", () => {
    expect(rewriteDocLink("ai-providers.md", "docs/self-hosting.md")).toBe("/docs/ai-providers/");
    expect(rewriteDocLink("accounts.md#oauth", "docs/self-hosting.md")).toBe("/docs/accounts/#oauth");
    expect(rewriteDocLink("data-model.md", "docs/desktop.md")).toBe("/docs/document-format/");
    expect(rewriteDocLink("docs/self-hosting.md", "CONTRIBUTING.md")).toBe("/docs/self-hosting/");
    expect(rewriteDocLink("SECURITY.md", "CONTRIBUTING.md")).toBe(`${REPO_BLOB}/SECURITY.md`);
    expect(rewriteDocLink("../.env.example", "docs/self-hosting.md")).toBe(`${REPO_BLOB}/.env.example`);
    expect(rewriteDocLink("#top", "docs/desktop.md")).toBe("#top");
  });

  it("summarise a document by its first paragraph", () => {
    expect(summaryOf("# T\n\nFirst [para](x.md) with `code`.\n\nSecond.")).toBe("First para with code.");
  });
});

describe("generatePages", () => {
  const files = generatePages(out, repo);

  it("writes a page per doc, the docs index, download and changelog", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        ...DOCS.map((d) => `docs/${d.slug}/index.html`),
        "docs/index.html",
        "download/index.html",
        "changelog/index.html",
      ]),
    );
  });

  it("covers self-hosting, each provider, the document format and contributing", () => {
    const read = (slug: string) => readFileSync(join(out, "docs", slug, "index.html"), "utf8");
    expect(read("self-hosting")).toContain("<h1");
    const providers = read("ai-providers");
    for (const name of ["Anthropic", "OpenAI", "OpenAI-compatible endpoints", "Ollama"])
      expect(providers).toContain(`>${name}</h3>`);
    expect(read("document-format")).toContain("<title>Document format — Vellum docs</title>");
    expect(read("contributing")).toContain("Contributing to Vellum");
    // No links back to raw Markdown files on the site.
    for (const d of DOCS) expect(read(d.slug)).not.toMatch(/href="(?!https?:)[^"]*\.md[#"]/);
  });
});
