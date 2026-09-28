import { ChevronDown, FilePlus2, FolderPlus, Library, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useApp } from "../state/app.js";
import { docPath, navigate, usePathname, useRoute } from "../state/router.js";

export function displayTitle(title: string): string {
  return title.trim() || "Untitled";
}

/** Primary navigation entries. Other screens add themselves here. */
export const NAV_ITEMS: Array<{ path: string; label: string; icon: ReactNode }> = [
  { path: "/library", label: "Library", icon: <Library size={15} /> },
];

function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="vl-nav">
      {NAV_ITEMS.map((item) => (
        <li key={item.path}>
          <a
            href={item.path}
            aria-current={pathname === item.path ? "page" : undefined}
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
  const { workspace, workspaces, collections, documents, createDocument, createCollection, switchWorkspace } =
    useApp();
  const route = useRoute();
  const activeId = route.name === "doc" ? route.id : null;
  const [query, setQuery] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? documents.filter((d) => displayTitle(d.title).toLowerCase().includes(q)) : documents;
  }, [documents, query]);

  const unfiled = filtered.filter((d) => !d.collectionId && !d.isTemplate);

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
      <div className="vl-ws">
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
      </div>

      <label className="vl-search">
        <Search size={14} aria-hidden />
        <input
          type="search"
          placeholder="Search"
          aria-label="Search documents"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

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
        {collections.map((c) => {
          const docs = filtered.filter((d) => d.collectionId === c.id && !d.isTemplate);
          return (
            <div key={c.id} className="vl-collection">
              <div className="vl-collection-name">
                <span className="vl-dot" style={{ background: c.color }} aria-hidden />
                {c.name}
                <span className="vl-count">{docs.length}</span>
              </div>
              <ul>
                {docs.map((d) => (
                  <li key={d.id}>
                    <a
                      href={docPath(d.id)}
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
            </div>
          );
        })}
        {unfiled.length > 0 && (
          <div className="vl-collection">
            <div className="vl-collection-name">
              <span className="vl-dot" style={{ background: "var(--muted)" }} aria-hidden />
              Unfiled
              <span className="vl-count">{unfiled.length}</span>
            </div>
            <ul>
              {unfiled.map((d) => (
                <li key={d.id}>
                  <a
                    href={docPath(d.id)}
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
          </div>
        )}
      </div>
    </nav>
  );
}
