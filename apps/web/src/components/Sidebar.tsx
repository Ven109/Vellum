import {
  ChartColumn,
  ChevronDown,
  FilePlus2,
  FolderPlus,
  Library,
  RefreshCw,
  Search,
  Settings,
  Users,
} from "lucide-react";
import type { DocumentMeta } from "@vellum/core";
import type { DragEvent, ReactNode } from "react";
import { useState } from "react";
import { useApp } from "../state/app.js";
import { CollectionMenu } from "./CollectionMenu.js";
import { GoalMeter } from "./GoalMeter.js";
import { useBackgroundSync } from "../data/background-sync.js";
import { Inbox } from "./Inbox.js";
import { MOD_KEY, useCommands } from "../state/commands.js";
import { docPath, navigate, usePathname, useRoute } from "../state/router.js";

export function displayTitle(title: string): string {
  return title.trim() || "Untitled";
}

/** Primary navigation entries. Other screens add themselves here. */
export const NAV_ITEMS: Array<{ path: string; label: string; icon: ReactNode }> = [
  { path: "/library", label: "Library", icon: <Library size={15} /> },
  { path: "/insights", label: "Insights", icon: <ChartColumn size={15} /> },
  { path: "/settings/account", label: "Settings", icon: <Settings size={15} /> },
];

function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="vl-nav">
      {NAV_ITEMS.map((item) => (
        <li key={item.path}>
          <a
            href={item.path}
            aria-current={
              pathname === item.path ||
              (item.path.startsWith("/settings") && pathname.startsWith("/settings"))
                ? "page"
                : undefined
            }
            onClick={(e) => {
              e.preventDefault();
              navigate(item.path);
            }}
          >
            {item.icon}
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar() {
  const { workspace, workspaces, createDocument, createCollection, switchWorkspace } = useApp();
  const route = useRoute();
  const activeId = route.name === "doc" ? route.id : null;
  const [switcherOpen, setSwitcherOpen] = useState(false);

  async function newDraft(collectionId: string | null = null) {
    const doc = await createDocument({ collectionId });
    navigate(docPath(doc.id));
  }

  async function newCollection() {
    const name = window.prompt("Collection name");
    if (name?.trim()) await createCollection(name.trim());
  }

  return (
    <nav className="vl-sidebar" aria-label="Workspace">
      <div className="vl-ws vl-ws-row">
        <button
          className="vl-ws-btn"
          aria-haspopup="menu"
          aria-expanded={switcherOpen}
          onClick={() => setSwitcherOpen((o) => !o)}
        >
          <span className="vl-ws-mark" aria-hidden>
            {workspace?.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="vl-ws-name">{workspace?.name}</span>
          <ChevronDown size={14} />
        </button>
        {switcherOpen && (
          <ul role="menu" className="vl-menu">
            {workspaces.map((w) => (
              <li key={w.id} role="none">
                <button
                  role="menuitemradio"
                  aria-checked={w.id === workspace?.id}
                  onClick={() => {
                    setSwitcherOpen(false);
                    void switchWorkspace(w.id);
                  }}
                >
                  {w.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Inbox />
      </div>

      <button className="vl-search" onClick={() => useCommands.getState().openPalette()}>
        <Search size={14} aria-hidden />
        <span>Search</span>
        <kbd>{MOD_KEY}K</kbd>
      </button>

      <NavLinks />

      <button className="vl-new" onClick={() => void newDraft()}>
        <FilePlus2 size={15} /> New draft
      </button>

      <div className="vl-nav-section">
        <div className="vl-nav-heading">
          <span>Collections</span>
          <button
            className="vl-icon-btn vl-small"
            aria-label="New collection"
            title="New collection"
            onClick={() => void newCollection()}
          >
            <FolderPlus size={14} />
          </button>
        </div>
        <CollectionsList activeId={activeId} />
      </div>
      <SharedWithMe activeId={activeId} />
      <SyncStatus />
      <GoalMeter />
    </nav>
  );
}

/** While the background sync is bringing documents up to date. */
function SyncStatus() {
  const { running, done, total } = useBackgroundSync();
  if (!running || total === 0) return null;
  return (
    <p className="vl-sync-status" role="status">
      <RefreshCw size={12} aria-hidden className="vl-spin" /> Syncing {Math.min(done + 1, total)} of {total}{" "}
      {total === 1 ? "document" : "documents"}…
    </p>
  );
}

const ROLE_WORD = {
  view: "can view",
  comment: "can comment",
  suggest: "can suggest",
  edit: "can edit",
} as const;

/** Documents other people shared with you directly or by link. */
function SharedWithMe({ activeId }: { activeId: string | null }) {
  const shared = useApp((s) => s.shared);
  if (!shared.length) return null;
  return (
    <div className="vl-nav-section">
      <div className="vl-nav-heading">
        <span>Shared with me</span>
      </div>
      <ul className="vl-shared-list" aria-label="Shared with me">
        {shared.map((d) => (
          <li key={d.docId}>
            <a
              href={docPath(d.docId)}
              aria-current={activeId === d.docId ? "page" : undefined}
              title={`${d.sharedBy} shared this · you ${ROLE_WORD[d.role]}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(docPath(d.docId));
              }}
            >
              <Users size={13} aria-hidden /> {displayTitle(d.title)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DOC_MIME = "application/x-vellum-doc";
const COLLECTION_MIME = "application/x-vellum-collection";

function DocLinks({ docs, activeId }: { docs: DocumentMeta[]; activeId: string | null }) {
  return (
    <ul>
      {docs.map((d) => (
        <li key={d.id}>
          <a
            href={docPath(d.id)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DOC_MIME, d.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            aria-current={d.id === activeId ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(docPath(d.id));
            }}
          >
            {displayTitle(d.title)}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Collections with drag-and-drop: drag a collection header onto another to reorder, or drag a document
 * onto a collection (or Unfiled) to move it. A document is only ever in one collection.
 */
function CollectionsList({ activeId }: { activeId: string | null }) {
  const { collections, documents, reorderCollections, updateDocument } = useApp();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const visible = documents.filter((d) => !d.isTemplate && d.status !== "archived");
  const unfiled = visible.filter((d) => !d.collectionId || !collections.some((c) => c.id === d.collectionId));

  function onDrop(e: DragEvent, targetId: string | null) {
    e.preventDefault();
    setDropTarget(null);
    const docId = e.dataTransfer.getData(DOC_MIME);
    const colId = e.dataTransfer.getData(COLLECTION_MIME);
    if (docId) {
      void updateDocument(docId, { collectionId: targetId });
    } else if (colId && targetId && colId !== targetId) {
      const ids = collections.map((c) => c.id).filter((id) => id !== colId);
      ids.splice(ids.indexOf(targetId), 0, colId);
      void reorderCollections(ids);
    }
  }

  function dropProps(targetId: string | null) {
    const key = targetId ?? "none";
    return {
      onDragOver: (e: DragEvent) => {
        if (
          e.dataTransfer.types.includes(DOC_MIME) ||
          (targetId && e.dataTransfer.types.includes(COLLECTION_MIME))
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget(key);
        }
      },
      onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
      onDrop: (e: DragEvent) => onDrop(e, targetId),
      "data-drop-target": dropTarget === key || undefined,
    };
  }

  return (
    <>
      {collections.map((c, i) => {
        const docs = visible.filter((d) => d.collectionId === c.id);
        return (
          <div key={c.id} className="vl-collection" {...dropProps(c.id)}>
            <div
              className="vl-collection-name"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(COLLECTION_MIME, c.id);
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <span className="vl-dot" style={{ background: c.color }} aria-hidden />
              <span className="vl-collection-label">{c.name}</span>
              <span className="vl-count">{docs.length}</span>
              <CollectionMenu
                collection={c}
                onMove={(delta) => {
                  const ids = collections.map((x) => x.id);
                  const j = i + delta;
                  if (j < 0 || j >= ids.length) return;
                  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
                  void reorderCollections(ids);
                }}
              />
            </div>
            <DocLinks docs={docs} activeId={activeId} />
          </div>
        );
      })}
      {(unfiled.length > 0 || dropTarget) && (
        <div className="vl-collection" {...dropProps(null)}>
          <div className="vl-collection-name">
            <span className="vl-dot" style={{ background: "var(--muted)" }} aria-hidden />
            <span className="vl-collection-label">Unfiled</span>
            <span className="vl-count">{unfiled.length}</span>
          </div>
          <DocLinks docs={unfiled} activeId={activeId} />
        </div>
      )}
    </>
  );
}
