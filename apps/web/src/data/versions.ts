import { countWords, createId, diffStats, diffWords } from "@vellum/core";
import type { Version, VersionAuthor, VersionReason } from "@vellum/core";
import { useApp } from "../state/app.js";

/**
 * Record a version of a document. Every version says who or what produced it, so assistant edits are
 * visible in history rather than hidden inside a person's autosave.
 */
export async function recordVersion(
  documentId: string,
  markdown: string,
  author: VersionAuthor,
  reason: VersionReason,
  name?: string,
): Promise<Version> {
  const repo = useApp.getState().repo;
  const previous = (await repo.listVersions(documentId))[0];
  const stats = diffStats(diffWords(previous?.markdown ?? "", markdown));
  const version: Version = {
    id: createId("ver"),
    documentId,
    createdAt: new Date().toISOString(),
    author,
    reason,
    ...(name ? { name } : {}),
    stats: { wordsAdded: stats.added, wordsRemoved: stats.removed, wordCount: countWords(markdown) },
    markdown,
  };
  await repo.putVersion(version);
  return version;
}
