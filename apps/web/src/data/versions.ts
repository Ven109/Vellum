import { RetentionPolicy, countWords, createId, diffStats, diffWords, versionsToPrune } from "@vellum/core";
import type { Version, VersionAuthor, VersionReason } from "@vellum/core";
import { create } from "zustand";
import { useApp } from "../state/app.js";
import { ApiError, api } from "./account.js";
import { syncWorkspaceFor } from "./server.js";

/** A version without its content, as listed in the timeline. */
export type VersionSummary = Omit<Version, "markdown"> & { markdown?: string; pending?: boolean };

/**
 * Version history. Synced documents keep a shared history on the server; documents that only live on
 * this device keep it in IndexedDB. A version made while offline is stored locally and uploaded later.
 * Every version says who or what produced it, so assistant edits are visible in history, not hidden.
 */
const PENDING = "vellum:pending-versions";

function pendingIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PENDING) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function setPending(ids: Set<string>) {
  try {
    localStorage.setItem(PENDING, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/** True when this document's history lives on the server. */
function onServer(documentId: string): boolean {
  return !!useApp.getState().account && !!syncWorkspaceFor(documentId);
}

/** Bumped whenever a document's history changes, so open timelines refresh. */
export const useVersionEvents = create<{ changed: Record<string, number> }>(() => ({ changed: {} }));
const touch = (documentId: string) =>
  useVersionEvents.setState((s) => ({
    changed: { ...s.changed, [documentId]: (s.changed[documentId] ?? 0) + 1 },
  }));

const lastMarkdown = new Map<string, string>();

async function previousMarkdown(documentId: string): Promise<string> {
  const cached = lastMarkdown.get(documentId);
  if (cached !== undefined) return cached;
  const latest = (await listVersions(documentId))[0];
  if (!latest) return "";
  return (await getVersion(documentId, latest.id))?.markdown ?? "";
}

async function uploadPending(documentId: string): Promise<void> {
  if (!onServer(documentId)) return;
  const repo = useApp.getState().repo;
  const ids = pendingIds();
  const mine = (await repo.listVersions(documentId)).filter((v) => ids.has(v.id)).reverse();
  for (const v of mine) {
    try {
      await api("POST", `/api/documents/${documentId}/versions`, v);
      ids.delete(v.id);
      await repo.deleteVersion(v.id);
    } catch {
      break; // still offline or not synced yet; try again next time
    }
  }
  setPending(ids);
}

async function pruneLocal(documentId: string): Promise<void> {
  const { repo, workspace } = useApp.getState();
  const policy = workspace?.settings.retention ?? RetentionPolicy.parse({});
  const pending = pendingIds();
  const local = (await repo.listVersions(documentId)).filter((v) => !pending.has(v.id));
  for (const id of versionsToPrune(local, policy)) await repo.deleteVersion(id);
}

export async function recordVersion(
  documentId: string,
  markdown: string,
  author: VersionAuthor,
  reason: VersionReason,
  name?: string,
  title?: string,
): Promise<Version> {
  const previous = await previousMarkdown(documentId);
  const stats = diffStats(diffWords(previous, markdown));
  const docTitle = title ?? useApp.getState().documents.find((d) => d.id === documentId)?.title;
  const version: Version = {
    id: createId("ver"),
    documentId,
    createdAt: new Date().toISOString(),
    author,
    reason,
    ...(name ? { name } : {}),
    ...(docTitle !== undefined ? { title: docTitle } : {}),
    stats: { wordsAdded: stats.added, wordsRemoved: stats.removed, wordCount: countWords(markdown) },
    markdown,
  };
  lastMarkdown.set(documentId, markdown);
  const repo = useApp.getState().repo;
  let stored = false;
  if (onServer(documentId)) {
    try {
      await uploadPending(documentId);
      await api("POST", `/api/documents/${documentId}/versions`, version);
      stored = true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) throw e;
    }
    if (!stored) {
      const ids = pendingIds();
      ids.add(version.id);
      setPending(ids);
    }
  }
  if (!stored) {
    await repo.putVersion(version);
    if (!onServer(documentId)) await pruneLocal(documentId);
  }
  touch(documentId);
  return version;
}

export async function listVersions(documentId: string): Promise<VersionSummary[]> {
  const repo = useApp.getState().repo;
  const pending = pendingIds();
  const local = (await repo.listVersions(documentId)).map((v) => ({ ...v, pending: pending.has(v.id) }));
  if (!onServer(documentId)) return local;
  await uploadPending(documentId);
  try {
    const remote = await api<VersionSummary[]>("GET", `/api/documents/${documentId}/versions`);
    const stillPending = (await repo.listVersions(documentId))
      .filter((v) => pendingIds().has(v.id))
      .map((v) => ({ ...v, pending: true }));
    return [...stillPending, ...remote].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return local;
  }
}

export async function getVersion(documentId: string, id: string): Promise<Version | undefined> {
  const local = (await useApp.getState().repo.listVersions(documentId)).find((v) => v.id === id);
  if (local) return local;
  if (!onServer(documentId)) return undefined;
  try {
    return await api<Version>("GET", `/api/documents/${documentId}/versions/${id}`);
  } catch {
    return undefined;
  }
}

/** Name a version (named versions are never pruned). An empty name removes it. */
export async function nameVersion(documentId: string, id: string, name: string): Promise<void> {
  const repo = useApp.getState().repo;
  const local = (await repo.listVersions(documentId)).find((v) => v.id === id);
  if (local) {
    const next = { ...local, name: name.trim() || undefined };
    if (!next.name) delete next.name;
    await repo.putVersion(next as Version);
  } else {
    await api("PATCH", `/api/documents/${documentId}/versions/${id}`, { name });
  }
  touch(documentId);
}

/** Set the workspace's retention policy (on the server for shared workspaces). */
export async function setRetention(policy: RetentionPolicy): Promise<void> {
  const { workspace, account, updateWorkspaceSettings } = useApp.getState();
  if (!workspace) return;
  if (account?.workspaces.some((w) => w.id === workspace.id))
    await api("PUT", `/api/workspaces/${workspace.id}/retention`, policy);
  await updateWorkspaceSettings({ retention: policy });
}

/** Keep the local copy of the policy in line with the server's. */
export async function loadRetention(): Promise<RetentionPolicy | null> {
  const { workspace, account, updateWorkspaceSettings } = useApp.getState();
  if (!workspace || !account?.workspaces.some((w) => w.id === workspace.id)) return null;
  try {
    const policy = await api<RetentionPolicy>("GET", `/api/workspaces/${workspace.id}/retention`);
    if (JSON.stringify(policy) !== JSON.stringify(workspace.settings.retention))
      await updateWorkspaceSettings({ retention: policy });
    return policy;
  } catch {
    return null;
  }
}
