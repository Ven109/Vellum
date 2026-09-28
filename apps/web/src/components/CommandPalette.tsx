import { fuzzyRank } from "@vellum/core";
import type { FuzzyMatch } from "@vellum/core";
import { CornerDownLeft, FileText, FilePlus2, TerminalSquare } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useApp } from "../state/app.js";
import { MOD_KEY, useCommands } from "../state/commands.js";
import type { Command } from "../state/commands.js";
import { docPath, navigate, splitPath, useRoute } from "../state/router.js";
import { displayTitle } from "./Sidebar.js";

type Item =
  | { kind: "doc"; id: string; title: string; subtitle?: string; match: FuzzyMatch }
  | { kind: "command"; command: Command; match: FuzzyMatch }
  | { kind: "create"; title: string };

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const parts: ReactNode[] = [];
  let run = "";
  let marked = false;
  const flush = (key: number) => {
    if (!run) return;
    parts.push(marked ? <mark key={key}>{run}</mark> : <Fragment key={key}>{run}</Fragment>);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== marked) {
      flush(i);
      marked = m;
    }
    run += text[i];
  }
  flush(text.length);
  return <>{parts}</>;
}

export function CommandPalette() {
  const { paletteOpen, closePalette, initialQuery, commands } = useCommands();
  const documents = useApp((s) => s.documents);
  const collections = useApp((s) => s.collections);
  const createDocument = useApp((s) => s.createDocument);
  const route = useRoute();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setQuery(initialQuery);
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen, initialQuery]);

  const commandMode = query.startsWith(">");
  const term = commandMode ? query.slice(1) : query;

  const items = useMemo<Item[]>(() => {
    const available = commands.filter((c) => !c.when || c.when());
    const cmdItems: Item[] = fuzzyRank(term, available, (c) => [c.title, ...(c.keywords ?? [])], 20).map(
      (r) => ({
        kind: "command",
        command: r.item,
        match: r.match,
      }),
    );
    if (commandMode) return cmdItems;
    const colName = new Map(collections.map((c) => [c.id, c.name]));
    const docs = documents.filter((d) => d.status !== "archived");
    const docItems: Item[] = fuzzyRank(
      term,
      docs,
      (d) => [displayTitle(d.title), colName.get(d.collectionId ?? "") ?? "", ...d.tags],
      term ? 30 : 8,
    ).map((r) => ({
      kind: "doc",
      id: r.item.id,
      title: displayTitle(r.item.title),
      subtitle: colName.get(r.item.collectionId ?? "") ?? (r.item.isTemplate ? "Template" : "Unfiled"),
      match: r.match,
    }));
    const out = [...docItems, ...(term ? cmdItems.slice(0, 6) : cmdItems.slice(0, 6))];
    if (term.trim() && docItems.length === 0) out.push({ kind: "create", title: term.trim() });
    return out;
  }, [commands, commandMode, term, documents, collections]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!paletteOpen) return null;

  async function run(item: Item | undefined, split: boolean) {
    if (!item) return;
    closePalette();
    if (item.kind === "doc") {
      if (split && route.name === "doc" && route.id !== item.id) navigate(splitPath(route.id, item.id));
      else navigate(docPath(item.id));
    } else if (item.kind === "command") {
      await item.command.run();
    } else {
      const doc = await createDocument({ title: item.title });
      navigate(docPath(doc.id));
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void run(items[active], e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  }

  const sections: Array<{ label: string; entries: Array<{ item: Item; index: number }> }> = [];
  items.forEach((item, index) => {
    const label =
      item.kind === "doc"
        ? "Documents"
        : item.kind === "command"
          ? (item.command.section ?? "Commands")
          : "Create";
    let section = sections.find((s) => s.label === label);
    if (!section) sections.push((section = { label, entries: [] }));
    section.entries.push({ item, index });
  });

  return (
    <div className="vl-palette-backdrop" onMouseDown={closePalette}>
      <div
        className="vl-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="vl-palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="vl-palette-list"
          aria-activedescendant={items.length ? `vl-palette-${active}` : undefined}
          placeholder="Search documents, or type > for commands"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul id="vl-palette-list" role="listbox" ref={listRef} className="vl-palette-list">
          {items.length === 0 && <li className="vl-palette-empty">No matching commands.</li>}
          {sections.map((section) => (
            <li key={section.label} role="presentation">
              <div className="vl-palette-section" role="presentation">
                {section.label}
              </div>
              <ul role="group" aria-label={section.label}>
                {section.entries.map(({ item, index }) => (
                  <li
                    key={index}
                    id={`vl-palette-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === active}
                    className="vl-palette-item"
                    onMouseMove={() => setActive(index)}
                    onClick={(e) => void run(item, e.metaKey || e.ctrlKey)}
                  >
                    {item.kind === "doc" && (
                      <>
                        <FileText size={15} aria-hidden />
                        <span className="vl-palette-title">
                          <Highlight text={item.title} indices={item.match.indices} />
                        </span>
                        <span className="vl-palette-sub">{item.subtitle}</span>
                      </>
                    )}
                    {item.kind === "command" && (
                      <>
                        {item.command.icon ?? <TerminalSquare size={15} aria-hidden />}
                        <span className="vl-palette-title">
                          <Highlight text={item.command.title} indices={item.match.indices} />
                        </span>
                        {item.command.shortcut && <kbd>{item.command.shortcut}</kbd>}
                      </>
                    )}
                    {item.kind === "create" && (
                      <>
                        <FilePlus2 size={15} aria-hidden />
                        <span className="vl-palette-title">Create draft “{item.title}”</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <footer className="vl-palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={11} />
            </kbd>{" "}
            open
          </span>
          <span>
            <kbd>{MOD_KEY}</kbd>
            <kbd>
              <CornerDownLeft size={11} />
            </kbd>{" "}
            open in split
          </span>
          <span>
            <kbd>&gt;</kbd> commands
          </span>
        </footer>
      </div>
    </div>
  );
}
