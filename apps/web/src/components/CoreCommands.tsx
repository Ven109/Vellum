import { docToMarkdown } from "@vellum/editor";
import {
  BookmarkPlus,
  Columns2,
  FilePlus2,
  FolderPlus,
  Library,
  Link2,
  Maximize2,
  SunMoon,
} from "lucide-react";
import { recordVersion } from "../data/versions.js";
import { useEffect } from "react";
import { useApp } from "../state/app.js";
import { useAssistant } from "../state/assistant.js";
import { useFocus } from "../state/focus.js";
import { useDocSession } from "../state/session.js";
import { MOD_KEY, useCommands } from "../state/commands.js";
import { docPath, navigate, parseRoute } from "../state/router.js";

const THEMES = ["system", "light", "dark"] as const;

export function applyTheme(theme: (typeof THEMES)[number]) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("vellum:theme", theme);
  } catch {
    /* ignore */
  }
}

/** Toggle focus mode and keep the cursor in the document. */
export function toggleFocus() {
  useFocus.getState().toggle();
  requestAnimationFrame(() => useDocSession.getState().editor?.view.focus());
}

function currentRoute() {
  return parseRoute(window.location.pathname, window.location.search);
}

/** Registers the built-in commands and the global ⌘K / Ctrl+K shortcut. */
export function CoreCommands() {
  const register = useCommands((s) => s.register);

  useEffect(() => {
    return register([
      {
        id: "doc.new",
        title: "New draft",
        section: "Commands",
        keywords: ["create", "document"],
        icon: <FilePlus2 size={15} />,
        run: async () => {
          const doc = await useApp.getState().createDocument();
          navigate(docPath(doc.id));
        },
      },
      {
        id: "nav.library",
        title: "Go to Library",
        section: "Navigation",
        keywords: ["documents", "home"],
        icon: <Library size={15} />,
        run: () => navigate("/library"),
      },
      {
        id: "collection.new",
        title: "New collection",
        section: "Commands",
        icon: <FolderPlus size={15} />,
        run: async () => {
          const name = window.prompt("Collection name");
          if (name?.trim()) await useApp.getState().createCollection(name.trim());
        },
      },
      {
        id: "view.theme",
        title: "Toggle theme (system / light / dark)",
        section: "View",
        keywords: ["dark mode", "appearance"],
        icon: <SunMoon size={15} />,
        run: () => {
          const current = (document.documentElement.dataset.theme ?? "system") as (typeof THEMES)[number];
          applyTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]!);
        },
      },
      {
        id: "doc.copyLink",
        title: "Copy link to this document",
        section: "Commands",
        icon: <Link2 size={15} />,
        when: () => currentRoute().name === "doc",
        run: () => navigator.clipboard?.writeText(window.location.origin + window.location.pathname),
      },
      {
        id: "view.focus",
        title: "Toggle focus mode",
        section: "View",
        keywords: ["distraction free", "zen", "full screen", "writing"],
        shortcut: `${MOD_KEY}⇧F`,
        icon: <Maximize2 size={15} />,
        when: () => currentRoute().name === "doc",
        run: () => toggleFocus(),
      },
      {
        id: "history.named",
        title: "Save a named version…",
        section: "Commands",
        keywords: ["checkpoint", "snapshot", "history", "milestone"],
        icon: <BookmarkPlus size={15} />,
        when: () => currentRoute().name === "doc" && !!useDocSession.getState().editor,
        run: async () => {
          const { editor, docId } = useDocSession.getState();
          const user = useApp.getState().user;
          if (!editor || !docId || !user) return;
          const name = window.prompt("Name this version", "")?.trim();
          if (!name) return;
          await recordVersion(
            docId,
            docToMarkdown(editor.state.doc),
            { kind: "user", userId: user.id },
            "named",
            name,
          );
        },
      },
      {
        id: "view.closeSplit",
        title: "Close split view",
        section: "View",
        icon: <Columns2 size={15} />,
        when: () => {
          const r = currentRoute();
          return r.name === "doc" && !!r.split;
        },
        run: () => {
          const r = currentRoute();
          if (r.name === "doc") navigate(docPath(r.id));
        },
      },
    ]);
  }, [register]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("vellum:theme") as (typeof THEMES)[number] | null;
      if (saved && saved !== "system") document.documentElement.dataset.theme = saved;
    } catch {
      /* ignore */
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        useAssistant.getState().toggle();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        if (currentRoute().name !== "doc") return;
        e.preventDefault();
        toggleFocus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const { paletteOpen, openPalette, closePalette } = useCommands.getState();
        if (paletteOpen) closePalette();
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}

export const PALETTE_SHORTCUT = `${MOD_KEY}K`;
