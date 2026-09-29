import { ResumeOnboarding } from "./OnboardingScreen.js";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  filterDocuments,
  groupDocuments,
  relativeTime,
  sortDocuments,
} from "@vellum/core";
import type { DocumentStatus, LibraryGroupBy, LibrarySort, LibraryTab } from "@vellum/core";
import { ChevronDown, ChevronRight, FilePlus2, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { displayTitle } from "../components/Sidebar.js";
import { usePref } from "../lib/prefs.js";
import { useApp } from "../state/app.js";
import { docPath, navigate } from "../state/router.js";

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "shared", label: "Shared with me" },
  { id: "published", label: "Published" },
  { id: "templates", label: "Templates" },
];

export function LibraryScreen() {
  const { documents, collections, user, createDocument, updateDocuments, deleteDocuments } = useApp();
  const [tab, setTab] = usePref<LibraryTab>("library.tab", "all");
  const [groupBy, setGroupBy] = usePref<LibraryGroupBy>("library.groupBy", "status");
  const [sort, setSort] = usePref<LibrarySort>("library.sort", "updated");
  const [collapsedByView, setCollapsedByView] = usePref<Record<string, string[]>>("library.collapsed", {});
  const viewKey = `${tab}:${groupBy}`;
  const collapsed = useMemo(() => collapsedByView[viewKey] ?? [], [collapsedByView, viewKey]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "">("");
  const [collectionFilter, setCollectionFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const filtered = filterDocuments(documents, {
      tab,
      userId: user?.id ?? "",
      query,
      statuses: statusFilter ? [statusFilter] : undefined,
      collectionId:
        collectionFilter === "" ? undefined : collectionFilter === "none" ? null : collectionFilter,
    });
    return groupDocuments(sortDocuments(filtered, sort), groupBy, collections);
  }, [documents, tab, user, query, statusFilter, collectionFilter, sort, groupBy, collections]);

  const visible = useMemo(
    () => groups.flatMap((g) => (collapsed.includes(g.key) ? [] : g.documents)),
    [groups, collapsed],
  );
  const total = groups.reduce((n, g) => n + g.documents.length, 0);
  const activeId = visible[Math.min(cursor, visible.length - 1)]?.id;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(key: string) {
    setCollapsedByView((all) => {
      const c = all[viewKey] ?? [];
      return { ...all, [viewKey]: c.includes(key) ? c.filter((k) => k !== key) : [...c, key] };
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (!visible.length) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setCursor((c) => Math.min(visible.length - 1, c + 1));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && activeId) {
      e.preventDefault();
      navigate(docPath(activeId));
    } else if ((e.key === " " || e.key === "x") && activeId) {
      e.preventDefault();
      toggle(activeId);
    } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setSelected(new Set(visible.map((d) => d.id)));
    } else if (e.key === "Escape") {
      setSelected(new Set());
    }
  }

  async function bulkDelete() {
    if (
      !window.confirm(
        `Delete ${selected.size} document${selected.size === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    await deleteDocuments([...selected]);
    setSelected(new Set());
  }

  const allVisibleSelected = visible.length > 0 && visible.every((d) => selected.has(d.id));

  return (
    <main className="vl-main vl-library">
      <ResumeOnboarding />
      <header className="vl-page-header">
        <h1>Library</h1>
        <button
          className="vl-btn vl-btn-primary"
          onClick={async () => {
            const doc = await createDocument({ isTemplate: tab === "templates" });
            navigate(docPath(doc.id));
          }}
        >
          <FilePlus2 size={14} /> {tab === "templates" ? "New template" : "New draft"}
        </button>
      </header>

      <div role="tablist" aria-label="Library views" className="vl-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setSelected(new Set());
              setCursor(0);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="vl-toolbar" role="search">
        <input
          className="vl-input"
          type="search"
          placeholder="Filter by title or tag"
          aria-label="Filter documents"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="vl-select"
          aria-label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DocumentStatus | "")}
        >
          <option value="">Any status</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="vl-select"
          aria-label="Collection"
          value={collectionFilter}
          onChange={(e) => setCollectionFilter(e.target.value)}
        >
          <option value="">Any collection</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">Unfiled</option>
        </select>
        <span className="vl-toolbar-spacer" />
        <label className="vl-inline-label">
          Group by
          <select
            className="vl-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as LibraryGroupBy)}
          >
            <option value="status">Status</option>
            <option value="collection">Collection</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="vl-inline-label">
          Sort
          <select className="vl-select" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
            <option value="updated">Last updated</option>
            <option value="title">Title</option>
            <option value="words">Word count</option>
          </select>
        </label>
      </div>

      {selected.size > 0 && (
        <div className="vl-bulkbar" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <select
            className="vl-select"
            aria-label="Move to collection"
            value=""
            onChange={async (e) => {
              const v = e.target.value;
              if (!v) return;
              await updateDocuments([...selected], { collectionId: v === "none" ? null : v });
            }}
          >
            <option value="">Move to…</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">Unfiled</option>
          </select>
          <select
            className="vl-select"
            aria-label="Set status"
            value=""
            onChange={async (e) => {
              const v = e.target.value as DocumentStatus | "";
              if (!v) return;
              await updateDocuments([...selected], { status: v });
            }}
          >
            <option value="">Set status…</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button className="vl-btn" onClick={() => void bulkDelete()}>
            <Trash2 size={14} /> Delete
          </button>
          <button className="vl-icon-btn" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X size={16} />
          </button>
        </div>
      )}

      <div
        className="vl-scroll vl-table-wrap"
        ref={tableRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Documents. Use arrow keys to move, Enter to open, Space to select."
      >
        {total === 0 ? (
          <p className="vl-empty-state">
            {tab === "templates"
              ? "No templates yet."
              : query
                ? "Nothing matches that filter."
                : "No documents here yet."}
          </p>
        ) : (
          <table className="vl-table vl-library-table">
            <thead>
              <tr>
                <th className="vl-col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected(allVisibleSelected ? new Set() : new Set(visible.map((d) => d.id)))
                    }
                  />
                </th>
                <th>Title</th>
                <th>Collection</th>
                <th>Status</th>
                <th>Updated</th>
                <th className="vl-num">Words</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const isCollapsed = collapsed.includes(g.key);
              return (
                <tbody key={g.key}>
                  {groupBy !== "none" && (
                    <tr className="vl-group-row">
                      <th colSpan={6} scope="rowgroup">
                        <button aria-expanded={!isCollapsed} onClick={() => toggleGroup(g.key)}>
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          {g.color && <span className="vl-dot" style={{ background: g.color }} aria-hidden />}
                          {g.label}
                          <span className="vl-count">{g.documents.length}</span>
                        </button>
                      </th>
                    </tr>
                  )}
                  {!isCollapsed &&
                    g.documents.map((d) => {
                      const col = collections.find((c) => c.id === d.collectionId);
                      const isActive = d.id === activeId;
                      return (
                        <tr
                          key={d.id}
                          className="vl-row"
                          aria-selected={selected.has(d.id)}
                          data-active={isActive || undefined}
                          onClick={() => navigate(docPath(d.id))}
                          onMouseEnter={() => setCursor(visible.findIndex((v) => v.id === d.id))}
                        >
                          <td className="vl-col-check" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${displayTitle(d.title)}`}
                              checked={selected.has(d.id)}
                              onChange={() => toggle(d.id)}
                            />
                          </td>
                          <td className="vl-col-title">
                            <a
                              href={docPath(d.id)}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate(docPath(d.id));
                              }}
                            >
                              {displayTitle(d.title)}
                            </a>
                          </td>
                          <td>
                            {col ? (
                              <span className="vl-chip">
                                <span className="vl-dot" style={{ background: col.color }} aria-hidden />
                                {col.name}
                              </span>
                            ) : (
                              <span className="vl-muted">—</span>
                            )}
                          </td>
                          <td>
                            <span className={`vl-status vl-status-${d.status}`}>
                              {STATUS_LABEL[d.status]}
                            </span>
                          </td>
                          <td className="vl-muted" title={new Date(d.updatedAt).toLocaleString()}>
                            {relativeTime(d.updatedAt)}
                          </td>
                          <td className="vl-num">{d.wordCount.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                </tbody>
              );
            })}
          </table>
        )}
      </div>
    </main>
  );
}
