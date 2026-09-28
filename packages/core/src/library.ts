import type { Collection, DocumentMeta, DocumentStatus } from "./model.js";

export type LibraryTab = "all" | "mine" | "shared" | "published" | "templates";
export type LibraryGroupBy = "status" | "collection" | "none";
export type LibrarySort = "updated" | "title" | "words";

export interface LibraryFilter {
  tab: LibraryTab;
  userId: string;
  query?: string;
  collectionId?: string | null;
  statuses?: DocumentStatus[];
}

export const STATUS_ORDER: DocumentStatus[] = ["draft", "in_review", "approved", "published", "archived"];

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};

export function filterDocuments(docs: DocumentMeta[], f: LibraryFilter): DocumentMeta[] {
  const q = f.query?.trim().toLowerCase();
  return docs.filter((d) => {
    if (f.tab === "templates") {
      if (!d.isTemplate) return false;
    } else if (d.isTemplate) return false;
    if (f.tab === "mine" && d.ownerId !== f.userId) return false;
    if (f.tab === "shared" && d.ownerId === f.userId) return false;
    if (f.tab === "published" && d.status !== "published") return false;
    if (
      f.tab !== "published" &&
      f.tab !== "templates" &&
      d.status === "archived" &&
      !f.statuses?.includes("archived")
    )
      return false;
    if (f.collectionId !== undefined && d.collectionId !== f.collectionId) return false;
    if (f.statuses?.length && !f.statuses.includes(d.status)) return false;
    if (
      q &&
      !(d.title || "untitled").toLowerCase().includes(q) &&
      !d.tags.some((t) => t.toLowerCase().includes(q))
    )
      return false;
    return true;
  });
}

export function sortDocuments(docs: DocumentMeta[], sort: LibrarySort): DocumentMeta[] {
  const copy = [...docs];
  if (sort === "title") copy.sort((a, b) => (a.title || "Untitled").localeCompare(b.title || "Untitled"));
  else if (sort === "words") copy.sort((a, b) => b.wordCount - a.wordCount);
  else copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return copy;
}

export interface DocumentGroup {
  key: string;
  label: string;
  color?: string;
  documents: DocumentMeta[];
}

export function groupDocuments(
  docs: DocumentMeta[],
  groupBy: LibraryGroupBy,
  collections: Collection[] = [],
): DocumentGroup[] {
  if (groupBy === "none") return [{ key: "all", label: "All documents", documents: docs }];
  if (groupBy === "status") {
    return STATUS_ORDER.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      documents: docs.filter((d) => d.status === s),
    })).filter((g) => g.documents.length > 0);
  }
  const groups: DocumentGroup[] = collections.map((c) => ({
    key: c.id,
    label: c.name,
    color: c.color,
    documents: docs.filter((d) => d.collectionId === c.id),
  }));
  groups.push({
    key: "none",
    label: "Unfiled",
    documents: docs.filter((d) => !d.collectionId || !collections.some((c) => c.id === d.collectionId)),
  });
  return groups.filter((g) => g.documents.length > 0);
}

/** "3 min ago", "Yesterday", "12 Sep" — compact relative time for tables. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diff = (now.getTime() - then.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (then.getTime() >= startOfToday) return `${Math.floor(diff / 3600)} h ago`;
  if (then.getTime() >= startOfToday - 86_400_000) return "Yesterday";
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
