import { describe, expect, it } from "vitest";
import { DocumentFormatError, parseDocumentFile, serializeDocumentFile, slugify } from "../src/index.js";

describe("document file format", () => {
  it("round-trips front matter and body", () => {
    const text = serializeDocumentFile({
      frontMatter: {
        vellum: 1,
        id: "doc_1",
        title: "The tool nobody talks about",
        status: "published",
        collection: "Essays",
        tags: ["craft"],
        created: "2026-09-01T09:00:00.000Z",
      },
      body: "# The tool nobody talks about\n\nEvery workshop has one.\n",
    });
    expect(text.startsWith("---\nvellum: 1\nid: doc_1\n")).toBe(true);
    const parsed = parseDocumentFile(text);
    expect(parsed.frontMatter.title).toBe("The tool nobody talks about");
    expect(parsed.frontMatter.status).toBe("published");
    expect(parsed.frontMatter.tags).toEqual(["craft"]);
    expect(parsed.body).toBe("# The tool nobody talks about\n\nEvery workshop has one.\n");
    expect(serializeDocumentFile(parsed)).toBe(text);
  });

  it("accepts plain markdown and takes the title from the first heading", () => {
    const parsed = parseDocumentFile("Intro line\n\n# Real title\n\nBody");
    expect(parsed.frontMatter.title).toBe("Real title");
    expect(parsed.frontMatter.status).toBe("draft");
    expect(parsed.body).toBe("Intro line\n\n# Real title\n\nBody");
  });

  it("rejects invalid or future front matter", () => {
    expect(() => parseDocumentFile("---\nstatus: bogus\n---\nx")).toThrow(DocumentFormatError);
    expect(() => parseDocumentFile("---\nvellum: 99\n---\nx")).toThrow(/newer/);
    expect(() => parseDocumentFile("---\n: : :\n---\nx")).toThrow(DocumentFormatError);
  });

  it("slugifies titles", () => {
    expect(slugify("Café & Crème: a Story!")).toBe("cafe-creme-a-story");
    expect(slugify("   ")).toBe("untitled");
  });
});
