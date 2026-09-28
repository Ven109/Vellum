import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { DocumentStatus, Timestamp } from "./model.js";

/**
 * Vellum documents are stored and exported as portable Markdown with a YAML front-matter header.
 * The header carries only what is needed to round-trip a document; comments, suggestions and history
 * live in sidecar JSON in a workspace export (see docs/data-model.md).
 */
export const DOCUMENT_FORMAT_VERSION = 1;

export const DocumentFrontMatter = z.object({
  vellum: z.number().int().default(DOCUMENT_FORMAT_VERSION),
  id: z.string().optional(),
  title: z.string().default(""),
  status: DocumentStatus.default("draft"),
  collection: z.string().optional(),
  tags: z.array(z.string()).default([]),
  created: Timestamp.optional(),
  updated: Timestamp.optional(),
  published: Timestamp.optional(),
});
export type DocumentFrontMatter = z.infer<typeof DocumentFrontMatter>;

export interface DocumentFile {
  frontMatter: DocumentFrontMatter;
  /** Markdown body, without the front-matter block. */
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class DocumentFormatError extends Error {
  override name = "DocumentFormatError";
}

/**
 * Parse a Markdown file. Plain Markdown without front matter is accepted (for imports): the title is then
 * taken from the first level-one heading, or left empty.
 */
export function parseDocumentFile(text: string): DocumentFile {
  const normalised = text.replace(/^\uFEFF/, "");
  const match = FENCE.exec(normalised);
  if (!match) {
    return { frontMatter: DocumentFrontMatter.parse({ title: firstHeading(normalised) }), body: normalised };
  }
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? "") ?? {};
  } catch (err) {
    throw new DocumentFormatError(`Invalid front matter: ${(err as Error).message}`);
  }
  const result = DocumentFrontMatter.safeParse(raw);
  if (!result.success) {
    throw new DocumentFormatError(`Invalid front matter: ${z.prettifyError(result.error)}`);
  }
  if (result.data.vellum > DOCUMENT_FORMAT_VERSION) {
    throw new DocumentFormatError(
      `Document format version ${result.data.vellum} is newer than this build supports (${DOCUMENT_FORMAT_VERSION}).`,
    );
  }
  const body = normalised.slice(match[0].length).replace(/^\r?\n/, "");
  const frontMatter = result.data.title ? result.data : { ...result.data, title: firstHeading(body) };
  return { frontMatter, body };
}

export function serializeDocumentFile(file: DocumentFile): string {
  const fm = DocumentFrontMatter.parse(file.frontMatter);
  const ordered: Record<string, unknown> = { vellum: DOCUMENT_FORMAT_VERSION };
  for (const key of [
    "id",
    "title",
    "status",
    "collection",
    "tags",
    "created",
    "updated",
    "published",
  ] as const) {
    const value = fm[key];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    ordered[key] = value;
  }
  const yaml = stringifyYaml(ordered, { lineWidth: 0 }).trimEnd();
  const body = file.body.endsWith("\n") ? file.body : `${file.body}\n`;
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function firstHeading(markdown: string): string {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return m?.[1]?.trim() ?? "";
}

/** File-system friendly slug used for exported file names. */
export function slugify(title: string, fallback = "untitled"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || fallback;
}
