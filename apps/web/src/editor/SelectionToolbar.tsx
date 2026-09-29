import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  MessageSquarePlus,
  Quote,
  Sparkles,
  Strikethrough,
} from "lucide-react";
import { useComments } from "../state/comments.js";
import { useAssistant } from "../state/assistant.js";
import { canSuggest, useSuggestions } from "../state/suggestions.js";
import type { ReactNode } from "react";

export interface ToolbarAction {
  id: string;
  label: string;
  icon: ReactNode;
  isActive?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

function promptLink(editor: Editor) {
  const previous = editor.getAttributes("link").href as string | undefined;
  const href = window.prompt("Link URL", previous ?? "https://");
  if (href === null) return;
  if (href === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
  else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

export const FORMAT_ACTIONS: ToolbarAction[] = [
  {
    id: "bold",
    label: "Bold",
    icon: <Bold size={16} />,
    isActive: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    label: "Italic",
    icon: <Italic size={16} />,
    isActive: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: "strike",
    label: "Strikethrough",
    icon: <Strikethrough size={16} />,
    isActive: (e) => e.isActive("strike"),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    id: "code",
    label: "Inline code",
    icon: <Code size={16} />,
    isActive: (e) => e.isActive("code"),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    id: "link",
    label: "Link",
    icon: <Link2 size={16} />,
    isActive: (e) => e.isActive("link"),
    run: promptLink,
  },
  {
    id: "h2",
    label: "Heading",
    icon: <Heading2 size={16} />,
    isActive: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "quote",
    label: "Quote",
    icon: <Quote size={16} />,
    isActive: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
];

/** Extra actions (comment, ...) registered by other features. */
export const extraSelectionActions: ToolbarAction[] = [
  {
    id: "comment",
    label: "Comment",
    icon: <MessageSquarePlus size={16} />,
    run: (editor) => {
      const { from, to } = editor.state.selection;
      if (from < to) useComments.getState().startComposing({ from, to });
    },
  },
  {
    id: "ask",
    label: "Ask the assistant",
    icon: <Sparkles size={16} />,
    run: () => {
      const a = useAssistant.getState();
      a.setContextMode("selection");
      a.setOpen(true);
    },
  },
];

export function SelectionToolbar({ editor }: { editor: Editor }) {
  const role = useSuggestions((s) => s.role);
  // Formatting needs edit (or suggest) access; commenting needs comment access; anyone can ask.
  const actions = [
    ...(canSuggest(role) ? FORMAT_ACTIONS : []),
    ...extraSelectionActions.filter((a) => a.id !== "comment" || role !== "view"),
  ];
  return (
    <BubbleMenu
      editor={editor}
      className="vl-bubble"
      options={{ placement: "top" }}
      // Unlike the default, also show for read-only documents so viewers can comment and ask.
      shouldShow={({ view, state }) => !state.selection.empty && view.hasFocus()}
    >
      <div role="toolbar" aria-label="Formatting" className="vl-bubble-inner">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            title={a.label}
            aria-label={a.label}
            aria-pressed={a.isActive?.(editor) ?? false}
            className="vl-icon-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => a.run(editor)}
          >
            {a.icon}
          </button>
        ))}
      </div>
    </BubbleMenu>
  );
}
