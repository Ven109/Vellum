import { getSchema } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import { DocumentStatus } from "@vellum/core";
import { docToMarkdown, vellumExtensions } from "@vellum/editor";

/**
 * Importers turn files from other tools into Markdown drafts. Supported: Markdown files and folders,
 * Notion's "Markdown & CSV" export (.zip), Google Docs downloaded as a web page (.html or .zip) or as
 * Word (.docx). Headings, emphasis, links and images are kept; local images are embedded.
 */
export interface SourceFile {
  /** Path inside the import, "/"-separated (a folder's relative path or a path inside a zip). */
  path: string;
  data: Uint8Array;
}

export interface ImportedDoc {
  title: string;
  markdown: string;
  /** Folder the document came from (or its front-matter collection), used as its collection. */
  folder: string | null;
  source: string;
  /** From a Vellum export's front matter. */
  status?: DocumentStatus;
}

export interface ImportResult {
  docs: ImportedDoc[];
  skipped: Array<{ path: string; reason: string }>;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

const ext = (path: string) => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
const basename = (path: string) => path.split("/").pop() ?? path;
const dirname = (path: string) => path.split("/").slice(0, -1).join("/");
const decoder = new TextDecoder();

/** Notion appends a 32-character hex id to every exported page and folder name. */
export function stripNotionId(name: string): string {
  return name.replace(/\s+[0-9a-f]{32}(?=$|\.)/i, "").trim();
}

function titleFromFilename(path: string): string {
  return (
    stripNotionId(basename(path).replace(/\.[^.]+$/, ""))
      .replace(/[_]+/g, " ")
      .trim() || "Untitled"
  );
}

function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function toBase64(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Resolve a relative image reference to an embedded data URL, when the file is part of the import. */
function imageResolver(files: Map<string, SourceFile>, fromDir: string) {
  return (src: string): string | null => {
    if (/^(https?:|data:)/i.test(src)) return src;
    let rel: string;
    try {
      rel = decodeURIComponent(src.split(/[?#]/)[0]!);
    } catch {
      rel = src;
    }
    const file = files.get(normalise(fromDir ? `${fromDir}/${rel}` : rel)) ?? files.get(normalise(rel));
    const type = file && IMAGE_TYPES[ext(file.path)];
    if (!file || !type || file.data.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${toBase64(file.data)}`;
  };
}

const STATUSES = DocumentStatus.options;

/** Split YAML front matter; returns the fields Vellum understands and the body. */
function frontMatter(text: string): {
  title?: string;
  collection?: string;
  status?: ImportedDoc["status"];
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { body: text };
  const field = (name: string) => {
    const raw = new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m").exec(m[1]!)?.[1];
    if (!raw) return undefined;
    if (raw.startsWith('"')) {
      try {
        return JSON.parse(raw) as string;
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw.replace(/^'(.*)'$/, "$1");
  };
  const status = field("status");
  return {
    ...(field("title") ? { title: field("title") } : {}),
    ...(field("collection") ? { collection: field("collection") } : {}),
    ...(status && (STATUSES as readonly string[]).includes(status)
      ? { status: status as ImportedDoc["status"] }
      : {}),
    body: text.slice(m[0].length),
  };
}

export function convertMarkdown(file: SourceFile, files: Map<string, SourceFile>): ImportedDoc {
  const raw = decoder
    .decode(file.data)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
  const fm = frontMatter(raw);
  let body = fm.body;
  let title = fm.title;
  // A leading "# Heading" is the title (Notion and most editors export it that way).
  const h1 = /^\s*#\s+(.+)\n?/.exec(body);
  if (h1 && (!title || h1[1]!.trim() === title)) {
    title = h1[1]!.trim();
    body = body.slice(h1[0].length);
  }
  const resolve = imageResolver(files, dirname(file.path));
  body = body
    // Images: embed local files; drop references to files that aren't in the import.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (all, alt: string, src: string) => {
      const url = resolve(src);
      if (url) return `![${alt}](${url})`;
      return alt ? `*[image: ${alt}]*` : "";
    })
    // Links between exported pages point at files that won't exist here; keep their text.
    .replace(/(?<!!)\[([^\]]+)\]\(((?!https?:|mailto:)[^)\s]+\.(?:md|markdown|html?|csv))\)/gi, "$1")
    .replace(/^\n+/, "");
  return {
    title: title ? stripNotionId(title) : titleFromFilename(file.path),
    markdown: body.trimEnd() + "\n",
    folder: fm.collection ?? null,
    source: file.path,
    ...(fm.status ? { status: fm.status } : {}),
  };
}

let cachedSchema: Schema | null = null;
const schema = () => (cachedSchema ??= getSchema(vellumExtensions()));

/**
 * Convert HTML (Google Docs web-page export, or .docx via mammoth) to Markdown through the editor schema,
 * so only structure the editor supports survives. Google Docs expresses bold/italic with inline styles
 * and wraps links in redirects; both are normalised first.
 */
export function htmlToMarkdown(html: string, resolveImage: (src: string) => string | null = () => null) {
  const dom = new DOMParser().parseFromString(html, "text/html");
  dom.querySelectorAll("style, script, meta, link, title").forEach((n) => n.remove());

  let title: string | undefined;
  const titleEl = dom.querySelector("p.title, h1.title");
  if (titleEl?.textContent?.trim()) {
    title = titleEl.textContent.trim();
    titleEl.remove();
  }

  dom.querySelectorAll<HTMLElement>("span[style]").forEach((span) => {
    const style = span.getAttribute("style") ?? "";
    let node: HTMLElement = span;
    const wrap = (tag: string) => {
      const el = dom.createElement(tag);
      while (node.firstChild) el.appendChild(node.firstChild);
      node.appendChild(el);
      node = el;
    };
    if (/font-weight:\s*(bold|[6-9]00)/.test(style)) wrap("strong");
    if (/font-style:\s*italic/.test(style)) wrap("em");
    if (/text-decoration:[^;]*line-through/.test(style)) wrap("s");
    if (/text-decoration:[^;]*underline/.test(style) && !span.closest("a")) wrap("u");
  });

  dom.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href")!;
    const google = /^https?:\/\/www\.google\.com\/url\?/.exec(href);
    if (google) {
      const q = new URL(href).searchParams.get("q");
      if (q) a.setAttribute("href", q);
    }
    if (href.startsWith("#")) a.replaceWith(...Array.from(a.childNodes));
  });

  // The Image extension refuses data: URLs from HTML, so embed through placeholders.
  const inline: string[] = [];
  dom.querySelectorAll("img").forEach((img) => {
    const url = resolveImage(img.getAttribute("src") ?? "");
    if (!url) {
      img.remove();
      return;
    }
    if (url.startsWith("data:")) {
      inline.push(url);
      img.setAttribute("src", `https://vellum.invalid/inline/${inline.length - 1}`);
    } else img.setAttribute("src", url);
  });

  const doc = PMDOMParser.fromSchema(schema()).parse(dom.body);
  let markdown = docToMarkdown(doc);
  markdown = markdown.replace(
    /https:\/\/vellum\.invalid\/inline\/(\d+)/g,
    (_, i: string) => inline[Number(i)]!,
  );
  return { title, markdown: markdown.trimEnd() + "\n" };
}

function convertHtml(file: SourceFile, files: Map<string, SourceFile>): ImportedDoc {
  const html = decoder.decode(file.data);
  const { title, markdown } = htmlToMarkdown(html, imageResolver(files, dirname(file.path)));
  const docTitle = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  return {
    title: title ?? (docTitle || titleFromFilename(file.path)),
    markdown,
    folder: null,
    source: file.path,
  };
}

async function convertDocx(file: SourceFile): Promise<ImportedDoc> {
  const mammoth = await import("mammoth");
  const buffer = file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength);
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer as ArrayBuffer });
  const { title, markdown } = htmlToMarkdown(value, (src) => src);
  return { title: title ?? titleFromFilename(file.path), markdown, folder: null, source: file.path };
}

/** Expand zips (Notion and Google exports) into their files. */
export async function expandArchives(files: SourceFile[]): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const f of files) {
    if (ext(f.path) !== "zip") {
      out.push(f);
      continue;
    }
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(f.data);
    const nested: SourceFile[] = Object.entries(entries)
      .filter(([p]) => !p.endsWith("/") && !p.startsWith("__MACOSX/"))
      .map(([p, data]) => ({ path: p, data }));
    // Notion wraps exports in zips inside zips for large workspaces.
    out.push(...(await expandArchives(nested)));
  }
  return out;
}

/** The common leading folder shared by every file (an export's wrapper folder), if any. */
function commonRoot(paths: string[]): string {
  const first = paths[0]?.split("/") ?? [];
  let depth = 0;
  while (depth < first.length - 1 && paths.every((p) => p.split("/")[depth] === first[depth])) depth++;
  return first.slice(0, depth).join("/");
}

export async function convertFiles(input: SourceFile[]): Promise<ImportResult> {
  const files = await expandArchives(input.map((f) => ({ ...f, path: normalise(f.path) })));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const root = commonRoot(files.map((f) => f.path));
  // A Vellum export: its README and manifest describe the files rather than being documents.
  const isVellumExport = files.some((f) => {
    if (basename(f.path) !== "vellum.json") return false;
    try {
      return (JSON.parse(decoder.decode(f.data)) as { format?: string }).format === "vellum-export";
    } catch {
      return false;
    }
  });
  const docs: ImportedDoc[] = [];
  const skipped: ImportResult["skipped"] = [];

  for (const f of files) {
    const kind = ext(f.path);
    if (isVellumExport && ["vellum.json", "README.md"].includes(f.path.slice(root ? root.length + 1 : 0)))
      continue;
    let doc: ImportedDoc | null = null;
    try {
      if (kind === "md" || kind === "markdown" || kind === "txt") doc = convertMarkdown(f, byPath);
      else if (kind === "html" || kind === "htm") doc = convertHtml(f, byPath);
      else if (kind === "docx") doc = await convertDocx(f);
      else if (IMAGE_TYPES[kind])
        continue; // embedded by the documents that use them
      else if (!basename(f.path).startsWith(".")) {
        skipped.push({
          path: f.path,
          reason: kind === "csv" ? "Databases aren't imported yet" : "Not a supported file type",
        });
      }
    } catch {
      skipped.push({ path: f.path, reason: "Couldn't read this file" });
    }
    if (!doc) continue;
    const rel = root ? f.path.slice(root.length + 1) : f.path;
    const dir = dirname(rel);
    if (isVellumExport) doc.folder ??= null;
    else doc.folder ??= dir ? stripNotionId(dir.split("/")[0]!) : null;
    docs.push(doc);
  }
  return { docs, skipped };
}

/** Read browser File objects (from a file or folder picker, or a drop) into source files. */
export async function readFiles(list: Iterable<File>): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const file of list) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    out.push({ path, data: new Uint8Array(await file.arrayBuffer()) });
  }
  return out;
}
