import type { AnyExtension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { AgentText } from "./agent.js";
import { Annotations } from "./annotations.js";
import { MarkdownPaste } from "./paste.js";
import { RewriteProposal } from "./proposal.js";
import { Suggestions } from "./suggestions.js";

export interface VellumExtensionOptions {
  placeholder?: string;
  /**
   * When the document is bound to a CRDT, undo/redo comes from the collaboration layer instead of
   * ProseMirror's history, so it only undoes the local user's changes.
   */
  collaborative?: boolean;
  /** Extra extensions (collaboration, suggestions, ...) appended after the core set. */
  extra?: AnyExtension[];
}

/**
 * The Vellum document schema: headings (1–3), paragraphs, blockquote, bullet and ordered lists, links,
 * inline code and code blocks, images and horizontal rules, plus bold/italic/strike/underline.
 * Markdown input shortcuts (`# `, `> `, `- `, `1. `, ``` ``` ```, `---`, `**bold**`, ...) come from the
 * individual node and mark extensions.
 */
export function vellumExtensions(options: VellumExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      undoRedo: options.collaborative ? false : { depth: 200 },
    }),
    Image.configure({ inline: true, allowBase64: false }),
    Placeholder.configure({ placeholder: options.placeholder ?? "Start writing…" }),
    Annotations,
    AgentText,
    MarkdownPaste,
    RewriteProposal,
    Suggestions,
    ...(options.extra ?? []),
  ];
}
