import { describe, expect, it } from "vitest";
import { filterDocuments, groupDocuments, relativeTime, sortDocuments } from "../src/index.js";
import type { Collection, DocumentMeta } from "../src/index.js";

const base = {
  workspaceId: "w",
  isTemplate: false,
  tags: [] as string[],
  createdAt: "2026-09-01T00:00:00.000Z",
};
const docs: DocumentMeta[] = [
  {
    ...base,
    id: "1",
    title: "Alpha",
    status: "draft",
    ownerId: "me",
    collectionId: "c1",
    wordCount: 100,
    updatedAt: "2026-09-03T00:00:00.000Z",
  },
  {
    ...base,
    id: "2",
    title: "Beta",
    status: "published",
    ownerId: "them",
    collectionId: null,
    wordCount: 900,
    updatedAt: "2026-09-05T00:00:00.000Z",
  },
  {
    ...base,
    id: "3",
    title: "Gamma",
    status: "in_review",
    ownerId: "me",
    collectionId: "c1",
    wordCount: 300,
    updatedAt: "2026-09-04T00:00:00.000Z",
    tags: ["craft"],
  },
  {
    ...base,
    id: "4",
    title: "Template",
    status: "draft",
    ownerId: "me",
    collectionId: null,
    wordCount: 10,
    updatedAt: "2026-09-02T00:00:00.000Z",
    isTemplate: true,
  },
  {
    ...base,
    id: "5",
    title: "Old",
    status: "archived",
    ownerId: "me",
    collectionId: null,
    wordCount: 10,
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
];
const collections: Collection[] = [
  { id: "c1", workspaceId: "w", name: "Essays", color: "#9A3412", sortOrder: 0 },
];

describe("library", () => {
  it("filters by tab", () => {
    const ids = (tab: Parameters<typeof filterDocuments>[1]["tab"]) =>
      filterDocuments(docs, { tab, userId: "me" }).map((d) => d.id);
    expect(ids("all")).toEqual(["1", "2", "3"]);
    expect(ids("mine")).toEqual(["1", "3"]);
    expect(ids("shared")).toEqual(["2"]);
    expect(ids("published")).toEqual(["2"]);
    expect(ids("templates")).toEqual(["4"]);
  });

  it("filters by query, tag, collection and status", () => {
    expect(filterDocuments(docs, { tab: "all", userId: "me", query: "gam" }).map((d) => d.id)).toEqual(["3"]);
    expect(filterDocuments(docs, { tab: "all", userId: "me", query: "craft" }).map((d) => d.id)).toEqual([
      "3",
    ]);
    expect(filterDocuments(docs, { tab: "all", userId: "me", collectionId: null }).map((d) => d.id)).toEqual([
      "2",
    ]);
    expect(
      filterDocuments(docs, { tab: "all", userId: "me", statuses: ["archived"] }).map((d) => d.id),
    ).toEqual(["5"]);
  });

  it("groups by status in workflow order and by collection", () => {
    const byStatus = groupDocuments(filterDocuments(docs, { tab: "all", userId: "me" }), "status");
    expect(byStatus.map((g) => g.label)).toEqual(["Draft", "In review", "Published"]);
    const byCollection = groupDocuments(docs.slice(0, 3), "collection", collections);
    expect(byCollection.map((g) => [g.label, g.documents.length])).toEqual([
      ["Essays", 2],
      ["Unfiled", 1],
    ]);
  });

  it("sorts", () => {
    expect(sortDocuments(docs.slice(0, 3), "updated").map((d) => d.id)).toEqual(["2", "3", "1"]);
    expect(sortDocuments(docs.slice(0, 3), "words").map((d) => d.id)).toEqual(["2", "3", "1"]);
    expect(sortDocuments(docs.slice(0, 3), "title").map((d) => d.id)).toEqual(["1", "2", "3"]);
  });

  it("formats relative time", () => {
    const now = new Date("2026-09-28T12:00:00");
    expect(relativeTime(new Date("2026-09-28T11:59:30").toISOString(), now)).toBe("Just now");
    expect(relativeTime(new Date("2026-09-28T11:30:00").toISOString(), now)).toBe("30 min ago");
    expect(relativeTime(new Date("2026-09-28T08:00:00").toISOString(), now)).toBe("4 h ago");
    expect(relativeTime(new Date("2026-09-27T08:00:00").toISOString(), now)).toBe("Yesterday");
    expect(relativeTime(new Date("2026-09-12T08:00:00").toISOString(), now)).toMatch(/^12 Sep/);
  });
});
