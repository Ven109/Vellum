import type { Editor } from "@tiptap/core";
import { ChevronDown, List, ListOrdered, MessageSquarePlus, Redo2, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useComments } from "../state/comments.js";
import { useAssistant } from "../state/assistant.js";
import { useKeyboardInset } from "../state/mobile.js";
import { canSuggest, useSuggestions } from "../state/suggestions.js";
import { FORMAT_ACTIONS } from "./SelectionToolbar.js";
import type { ToolbarAction } from "./SelectionToolbar.js";

const pick = (id: string) => FORMAT_ACTIONS.find((a) => a.id === id)!;

const LIST_ACTIONS: ToolbarAction[] = [
  {
    id: "bullets",
    label: "Bulleted list",
    icon: <List size={18} />,
    isActive: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbers",
    label: "Numbered list",
    icon: <ListOrdered size={18} />,
    isActive: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
];

const HISTORY_ACTIONS: ToolbarAction[] = [
  { id: "undo", label: "Undo", icon: <Undo2 size={18} />, run: (e) => e.chain().focus().undo().run() },
  { id: "redo", label: "Redo", icon: <Redo2 size={18} />, run: (e) => e.chain().focus().redo().run() },
];

/**
 * The phone formatting bar: docked to the bottom of the screen, above the on-screen keyboard when it's
 * open, with 44px touch targets. Buttons keep the editor focused so the keyboard doesn't close.
 */
export function MobileToolbar({ editor }: { editor: Editor }) {
  const role = useSuggestions((s) => s.role);
  const [, force] = useState(0);
  const [focused, setFocused] = useState(editor.isFocused);
  useKeyboardInset(true);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    editor.on("transaction", rerender);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("transaction", rerender);
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  const hasSelection = !editor.state.selection.empty;
  const actions: ToolbarAction[] = [
    ...(canSuggest(role)
      ? [pick("bold"), pick("italic"), pick("h2"), ...LIST_ACTIONS, pick("quote"), ...HISTORY_ACTIONS]
      : []),
    ...(hasSelection && role !== "view"
      ? [
          {
            id: "comment",
            label: "Comment",
            icon: <MessageSquarePlus size={18} />,
            run: (e: Editor) => {
              const { from, to } = e.state.selection;
              useComments.getState().startComposing({ from, to });
            },
          },
        ]
      : []),
    {
      id: "ask",
      label: "Ask the assistant",
      icon: <Sparkles size={18} />,
      run: () => {
        const a = useAssistant.getState();
        a.setContextMode(hasSelection ? "selection" : "document");
        a.setOpen(true);
      },
    },
  ];

  return (
    <div
      className="vl-mobile-toolbar"
      role="toolbar"
      aria-label="Formatting"
      data-focused={focused || undefined}
    >
      <div className="vl-mobile-toolbar-scroll">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-label={a.label}
            aria-pressed={a.isActive ? a.isActive(editor) : undefined}
            // Keep focus (and the keyboard) in the editor.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => a.run(editor)}
          >
            {a.icon}
          </button>
        ))}
      </div>
      {focused && (
        <button
          type="button"
          className="vl-mobile-toolbar-done"
          aria-label="Hide keyboard"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            // Blurring the editor closes the on-screen keyboard.
            editor.view.dom.blur();
            window.getSelection()?.removeAllRanges();
          }}
        >
          <ChevronDown size={18} />
        </button>
      )}
    </div>
  );
}
