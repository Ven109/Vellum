import { getSchema } from "@tiptap/core";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import type { DocumentMeta } from "@vellum/core";
import { docToMarkdown, vellumExtensions } from "@vellum/editor";
import { useApp } from "../state/app.js";
import { serverBaseUrl } from "./server.js";
import { acquireDoc, contentOf, releaseDoc, titleOf } from "./ydocs.js";

const enc = new TextEncoder();

function slug(text: string, fallback: string): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || fallback;
}

const yamlString = (s: string) => JSON.stringify(s);

async function waitForSync(live: ReturnType<typeof acquireDoc>, ms = 5000) {
  const start = Date.now();
  while (live.remote && !live.remote.isSynced && live.remote.state !== "denied" && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

/**
 * Export the whole workspace to a zip of portable files: one Markdown file per document (with a small
 * front-matter header) in a folder per collection, images alongside in assets/, and vellum.json with
 * the workspace's metadata and writing settings. The zip can be imported back into any Vellum.
 */
export async function exportWorkspace(onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const { repo, workspace, collections } = useApp.getState();
  if (!workspace) throw new Error("No workspace");
  const docs = (await repo.listDocuments(workspace.id)).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const schema = getSchema(vellumExtensions());
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const assets = new Map<string, string>(); // source → assets/<name>
  const manifest: Array<Omit<DocumentMeta, "workspaceId"> & { path: string; collection: string | null }> = [];

  const addAsset = async (src: string): Promise<string | null> => {
    const known = assets.get(src);
    if (known) return known;
    let bytes: Uint8Array;
    let type: string;
    const data = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(src);
    if (data) {
      type = data[1]!;
      bytes = Uint8Array.from(atob(data[2]!), (c) => c.charCodeAt(0));
    } else if (src.startsWith("/files/")) {
      const res = await fetch(`${serverBaseUrl()}${src}`, { credentials: "include" }).catch(() => null);
      if (!res?.ok) return null;
      type = res.headers.get("content-type") ?? "";
      bytes = new Uint8Array(await res.arrayBuffer());
    } else return null;
    const name = `assets/image-${assets.size + 1}.${EXT[type] ?? "bin"}`;
    files[name] = bytes;
    assets.set(src, name);
    return name;
  };

  for (const [i, meta] of docs.entries()) {
    const live = acquireDoc(meta.id);
    try {
      await live.whenLoaded;
      await waitForSync(live);
      const title = titleOf(live.doc).toString() || meta.title;
      let markdown = docToMarkdown(yXmlFragmentToProseMirrorRootNode(contentOf(live.doc), schema));
      for (const m of [...markdown.matchAll(/!\[([^\]]*)\]\(((?:data:|\/files\/)[^)\s]+)\)/g)]) {
        const asset = await addAsset(m[2]!);
        if (asset) markdown = markdown.replace(m[2]!, `../${asset}`);
      }
      const collection = collections.find((c) => c.id === meta.collectionId) ?? null;
      const folder = collection ? slug(collection.name, "collection") : "unfiled";
      let path = `${folder}/${slug(title, "untitled")}.md`;
      for (let n = 2; used.has(path); n++) path = `${folder}/${slug(title, "untitled")}-${n}.md`;
      used.add(path);
      const header = [
        "---",
        `title: ${yamlString(title || "Untitled")}`,
        `status: ${meta.status}`,
        ...(collection ? [`collection: ${yamlString(collection.name)}`] : []),
        ...(meta.tags.length ? [`tags: [${meta.tags.map(yamlString).join(", ")}]`] : []),
        `created: ${meta.createdAt}`,
        `updated: ${meta.updatedAt}`,
        `id: ${meta.id}`,
        "---",
        "",
      ].join("\n");
      files[path] = enc.encode(`${header}# ${title || "Untitled"}\n\n${markdown.trim()}\n`);
      const { workspaceId: _ws, ...rest } = meta;
      manifest.push({ ...rest, title, path, collection: collection?.name ?? null });
    } finally {
      releaseDoc(meta.id);
    }
    onProgress?.(i + 1, docs.length);
  }

  files["vellum.json"] = enc.encode(
    JSON.stringify(
      {
        format: "vellum-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        workspace: {
          name: workspace.name,
          settings: { ...workspace.settings, voice: workspace.settings.voice },
        },
        collections: collections.map(({ id, name, color, sortOrder }) => ({ id, name, color, sortOrder })),
        documents: manifest,
      },
      null,
      2,
    ),
  );
  files["README.md"] = enc.encode(
    `# ${workspace.name}\n\nExported from Vellum on ${new Date().toUTCString()}.\n\n` +
      `- Each document is a Markdown file with a short header (title, status, collection, dates).\n` +
      `- Folders are collections; unfiled documents are in \`unfiled/\`.\n` +
      `- Images are in \`assets/\`.\n` +
      `- \`vellum.json\` has the workspace's metadata, house rules and voice settings.\n\n` +
      `To bring this back into Vellum, choose Settings → Workspace and people → Import and pick this zip.\n`,
  );
  const { zipSync } = await import("fflate");
  const zip = zipSync(files, { level: 6 });
  return new Blob([zip], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
