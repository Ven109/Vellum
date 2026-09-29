import MarkdownIt from "markdown-it";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { MarkdownParser, MarkdownSerializer } from "prosemirror-markdown";
import type { MarkdownSerializerState } from "prosemirror-markdown";

/**
 * Markdown <-> ProseMirror conversion for Vellum's schema. Markdown is the portable document format
 * (see docs/data-model.md), so every node and mark in the schema must round-trip.
 */
const md = new MarkdownIt("commonmark", { html: false, linkify: true }).enable(["strikethrough", "linkify"]);

const parsers = new WeakMap<Schema, MarkdownParser>();

export function markdownParser(schema: Schema): MarkdownParser {
  let parser = parsers.get(schema);
  if (!parser) {
    parser = new MarkdownParser(schema, md as unknown as ConstructorParameters<typeof MarkdownParser>[1], {
      blockquote: { block: "blockquote" },
      paragraph: { block: "paragraph" },
      list_item: { block: "listItem" },
      bullet_list: { block: "bulletList" },
      ordered_list: {
        block: "orderedList",
        getAttrs: (tok) => ({ start: Number(tok.attrGet("start") ?? 1) }),
      },
      heading: { block: "heading", getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }) },
      code_block: { block: "codeBlock", noCloseToken: true },
      fence: {
        block: "codeBlock",
        getAttrs: (tok) => ({ language: tok.info.trim() || null }),
        noCloseToken: true,
      },
      hr: { node: "horizontalRule" },
      image: {
        node: "image",
        getAttrs: (tok) => ({
          src: tok.attrGet("src"),
          title: tok.attrGet("title") || null,
          alt: tok.children?.[0]?.content || null,
        }),
      },
      hardbreak: { node: "hardBreak" },
      em: { mark: "italic" },
      strong: { mark: "bold" },
      s: { mark: "strike" },
      link: {
        mark: "link",
        getAttrs: (tok) => ({ href: tok.attrGet("href"), title: tok.attrGet("title") || null }),
      },
      code_inline: { mark: "code", noCloseToken: true },
    });
    parsers.set(schema, parser);
  }
  return parser;
}

function backticksFor(node: PMNode, side: number): string {
  const ticks = /`+/g;
  let m: RegExpExecArray | null;
  let len = 0;
  if (node.isText) while ((m = ticks.exec(node.text ?? ""))) len = Math.max(len, m[0].length);
  let result = len > 0 && side > 0 ? " `" : "`";
  for (let i = 0; i < len; i++) result += "`";
  if (len > 0 && side < 0) result += " ";
  return result;
}

export const markdownSerializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    codeBlock(state, node) {
      const backticks = node.textContent.match(/`{3,}/gm);
      const fence = backticks ? backticks.sort().slice(-1)[0] + "`" : "```";
      state.write(fence + (node.attrs.language || "") + "\n");
      state.text(node.textContent, false);
      state.write("\n");
      state.write(fence);
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write(state.repeat("#", node.attrs.level as number) + " ");
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    horizontalRule(state, node) {
      state.write("---");
      state.closeBlock(node);
    },
    bulletList(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    orderedList(state, node) {
      const start = (node.attrs.start as number) || 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = state.repeat(" ", maxW + 2);
      state.renderList(node, space, (i) => {
        const nStr = String(start + i);
        return state.repeat(" ", maxW - nStr.length) + nStr + ". ";
      });
    },
    listItem(state, node) {
      state.renderContent(node);
    },
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    image(state, node) {
      state.write(
        "![" +
          state.esc((node.attrs.alt as string) || "") +
          "](" +
          (node.attrs.src as string).replace(/[()]/g, "\\$&") +
          (node.attrs.title ? ' "' + (node.attrs.title as string).replace(/"/g, '\\"') + '"' : "") +
          ")",
      );
    },
    hardBreak(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++)
        if (parent.child(i).type !== node.type) {
          state.write("\\\n");
          return;
        }
    },
    text(state, node) {
      state.text(node.text ?? "", !(state as MarkdownSerializerState & { inAutolink?: boolean }).inAutolink);
    },
  },
  {
    italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    // Markdown has no underline; keep the text, drop the mark.
    underline: { open: "", close: "" },
    // Pending suggestions are review state, not content; their text is kept as-is.
    suggestionInsert: { open: "", close: "" },
    suggestionDelete: { open: "", close: "" },
    link: {
      open: "[",
      close(_state, mark) {
        const title = mark.attrs.title ? ` "${(mark.attrs.title as string).replace(/"/g, '\\"')}"` : "";
        return `](${(mark.attrs.href as string).replace(/[()"]/g, "\\$&")}${title})`;
      },
      mixable: false,
    },
    code: {
      open(_state, _mark, parent, index) {
        return backticksFor(parent.child(index), -1);
      },
      close(_state, _mark, parent, index) {
        return backticksFor(parent.child(index - 1), 1);
      },
      escape: false,
    },
  },
  { strict: false },
);

export function markdownToDoc(schema: Schema, markdown: string): PMNode {
  return markdownParser(schema).parse(markdown);
}

export function docToMarkdown(doc: PMNode): string {
  return markdownSerializer.serialize(doc, { tightLists: true }) + "\n";
}

/** Heuristic: does plain pasted text look like Markdown worth parsing? */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|---\s*$)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`/.test(
    text,
  );
}
