import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Heading2, Italic, Link2, Quote, Strikethrough } from "lucide-react";
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

/** Extra actions (comment, ask the assistant, ...) registered by other features. */
export const extraSelectionActions: ToolbarAction[] = [];

export function SelectionToolbar({ editor }: { editor: Editor }) {
  const actions = [...FORMAT_ACTIONS, ...extraSelectionActions];
  return (
    <BubbleMenu editor={editor} className="vl-bubble" options={{ placement: "top" }}>
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
