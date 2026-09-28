import { WorkspaceSettings, createId } from "@vellum/core";
import type { Collection, DocumentMeta, User, Workspace } from "@vellum/core";
import type { Repository } from "./repository.js";

const COLLECTION_COLOURS = ["#9A3412", "#1D4ED8", "#047857", "#7C3AED", "#B45309", "#BE185D"];

export function nextCollectionColour(existing: number): string {
  return COLLECTION_COLOURS[existing % COLLECTION_COLOURS.length]!;
}

/** First run: create a local user and a workspace with a welcome draft so the app is never empty. */
export async function ensureSeeded(repo: Repository): Promise<{ user: User; workspace: Workspace }> {
  const now = new Date().toISOString();
  let user = await repo.getCurrentUser();
  if (!user) {
    user = { id: createId("usr"), email: "you@localhost.invalid", name: "You", avatarColor: "#9A3412", createdAt: now };
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
    const essays: Collection = { id: createId("col"), workspaceId: workspace.id, name: "Essays", color: COLLECTION_COLOURS[0]!, sortOrder: 0 };
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
