import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { convertFiles, htmlToMarkdown, stripNotionId } from "../src/data/importers.js";

const enc = new TextEncoder();
const file = (path: string, text: string | Uint8Array) => ({
  path,
  data: typeof text === "string" ? enc.encode(text) : text,
});
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("markdown import", () => {
  it("uses front matter or the first heading as the title and keeps structure", async () => {
    const { docs } = await convertFiles([
      file(
        "notes/essays/one.md",
        "---\ntitle: The first\n---\n# The first\n\nSome *emphasis* and a [link](https://x.test).\n",
      ),
      file("notes/two.md", "## Not a title\n\nBody **bold**.\n"),
    ]);
    expect(docs).toEqual([
      expect.objectContaining({
        title: "The first",
        folder: "essays",
        markdown: "Some *emphasis* and a [link](https://x.test).\n",
      }),
      expect.objectContaining({ title: "two", folder: null, markdown: "## Not a title\n\nBody **bold**.\n" }),
    ]);
  });

  it("embeds local images and drops ones that aren't in the import", async () => {
    const { docs } = await convertFiles([
      file(
        "post.md",
        "# Post\n\n![A chart](img/chart.png)\n\n![Gone](missing.png)\n\n![Web](https://x.test/a.png)\n",
      ),
      file("img/chart.png", PNG),
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.markdown).toContain("![A chart](data:image/png;base64,iVBORw0KGgo=)");
    expect(docs[0]!.markdown).toContain("*[image: Gone]*");
    expect(docs[0]!.markdown).toContain("![Web](https://x.test/a.png)");
  });
});

describe("Notion export", () => {
  it("reads the zip, strips page ids, maps sub-pages to collections and skips databases", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    const zip = zipSync({
      [`Export-abc/Home ${id}.md`]: enc.encode(`# Home\n\nSee [Child](Home%20${id}/Child%20${id}.md).\n`),
      [`Export-abc/Home ${id}/Child ${id}.md`]: enc.encode(`# Child\n\n![pic](Untitled.png)\n`),
      [`Export-abc/Home ${id}/Untitled.png`]: PNG,
      [`Export-abc/Tasks ${id}.csv`]: enc.encode("Name,Status\n"),
    });
    const { docs, skipped } = await convertFiles([file("notion.zip", zip)]);
    expect(docs.map((d) => [d.title, d.folder])).toEqual([
      ["Home", null],
      ["Child", "Home"],
    ]);
    expect(docs[0]!.markdown).toBe("See Child.\n");
    expect(docs[1]!.markdown).toContain("data:image/png;base64,");
    expect(skipped).toEqual([
      { path: `Export-abc/Tasks ${id}.csv`, reason: "Databases aren't imported yet" },
    ]);
    expect(stripNotionId(`Page ${id}.md`)).toBe("Page.md");
  });
});

describe("Google Docs HTML", () => {
  it("turns styled spans into emphasis, unwraps redirect links and keeps headings", () => {
    const html = `<html><head><title>Doc</title><style>.c1{font-weight:700}</style></head><body>
      <p class="title"><span>My essay</span></p>
      <h2><span>Section</span></h2>
      <p><span style="font-weight:700">Bold</span> and <span style="font-style:italic">italic</span> and
      <a href="https://www.google.com/url?q=https://example.com/page&amp;sa=D">a link</a>.</p>
      <p><img src="images/image1.png" alt="Figure"></p></body></html>`;
    const out = htmlToMarkdown(html, (src) =>
      src === "images/image1.png" ? "data:image/png;base64,AAAA" : null,
    );
    expect(out.title).toBe("My essay");
    expect(out.markdown).toContain("## Section");
    expect(out.markdown).toContain("**Bold** and *italic* and [a link](https://example.com/page).");
    expect(out.markdown).toContain("![Figure](data:image/png;base64,AAAA)");
  });

  it("imports a Google Docs web-page zip with its images", async () => {
    const zip = zipSync({
      "MyEssay.html": enc.encode(
        `<html><head><title>My Essay</title></head><body><p>Hello <img src="images/image1.png"></p></body></html>`,
      ),
      "images/image1.png": PNG,
    });
    const { docs } = await convertFiles([file("MyEssay.zip", zip)]);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.title).toBe("My Essay");
    expect(docs[0]!.markdown).toMatch(/Hello !\[\]\(data:image\/png;base64,/);
  });
});
