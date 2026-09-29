import { useOnboarding } from "../state/onboarding.js";
import { WorkspaceSettings, createId } from "@vellum/core";
import type { Collection, DocumentMeta, User, Workspace } from "@vellum/core";
import type { Me } from "./account.js";
import type { Repository } from "./repository.js";

const COLLECTION_COLOURS = ["#9A3412", "#1D4ED8", "#047857", "#7C3AED", "#B45309", "#BE185D"];

export function nextCollectionColour(existing: number): string {
  return COLLECTION_COLOURS[existing % COLLECTION_COLOURS.length]!;
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";

/**
 * Signed in to a server: the account's identity and workspaces replace the local-only ones. Local
 * records are created for server workspaces this device hasn't seen yet (content syncs per document).
 */
export async function adoptAccount(repo: Repository, account: Me): Promise<void> {
  const existing = await repo.getCurrentUser();
  const user: User = {
    id: account.user.id,
    email: account.user.email,
    name: account.user.name,
    avatarColor: account.user.avatarColor,
    createdAt: account.user.createdAt,
  };
  await repo.putUser(user);
  if (existing?.id !== user.id) await repo.putSetting("currentUserId", user.id);
  const known = new Map((await repo.listWorkspaces()).map((w) => [w.id, w]));
  for (const w of account.workspaces) {
    const local = known.get(w.id);
    if (local) {
      if (local.name !== w.name) await repo.putWorkspace({ ...local, name: w.name });
      continue;
    }
    await repo.putWorkspace({
      id: w.id,
      name: w.name,
      slug: slugify(w.name),
      createdAt: new Date().toISOString(),
      settings: WorkspaceSettings.parse({}),
    });
  }
  const current = await repo.getSetting<string>("currentWorkspaceId");
  if (account.workspaces.length && !account.workspaces.some((w) => w.id === current))
    await repo.putSetting("currentWorkspaceId", account.workspaces[0]!.id);
}

/** First run: create a local user and a workspace with a welcome draft so the app is never empty. */
export async function ensureSeeded(
  repo: Repository,
  account?: Me,
): Promise<{ user: User; workspace: Workspace }> {
  const now = new Date().toISOString();
  const fresh = (await repo.listWorkspaces()).length === 0;
  if (account) await adoptAccount(repo, account);
  let user = await repo.getCurrentUser();
  if (!user) {
    user = {
      id: createId("usr"),
      email: "you@localhost.invalid",
      name: "You",
      avatarColor: "#9A3412",
      createdAt: now,
    };
    await repo.putUser(user);
  }
  const workspaces = await repo.listWorkspaces();
  const currentId = await repo.getSetting<string>("currentWorkspaceId");
  let workspace = workspaces.find((w) => w.id === currentId) ?? workspaces[0];
  if (!workspace) {
    workspace = {
      id: createId("wsp"),
      name: "My workspace",
      slug: "my-workspace",
      createdAt: now,
      settings: WorkspaceSettings.parse({}),
    };
    await repo.putWorkspace(workspace);
  }
  if (fresh && !account) useOnboarding.getState().start();
  if (fresh) {
    const essays: Collection = {
      id: createId("col"),
      workspaceId: workspace.id,
      name: "Essays",
      color: COLLECTION_COLOURS[0]!,
      sortOrder: 0,
    };
    await repo.putCollection(essays);
    const welcome: DocumentMeta = {
      id: createId("doc"),
      workspaceId: workspace.id,
      collectionId: essays.id,
      title: "Welcome to Vellum",
      status: "draft",
      ownerId: user.id,
      isTemplate: false,
      tags: [],
      wordCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await repo.putDocument(welcome);
    await repo.putSetting("welcomeDocId", welcome.id);
  }
  await repo.putSetting("currentWorkspaceId", workspace.id);
  return { user, workspace };
}

export const WELCOME_MARKDOWN = `Vellum is a place to write long-form. Everything you type is saved as you go, works offline, and is stored as portable Markdown.

## A few things to try

- Select some text to see the formatting toolbar.
- Type \`## \` at the start of a line for a heading, \`> \` for a quote, or \`- \` for a list.
- Headings appear in the outline on the right.

When you're ready, create a new draft from the sidebar.
`;
