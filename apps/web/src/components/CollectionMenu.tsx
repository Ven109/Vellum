import type { Collection } from "@vellum/core";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/app.js";

export const COLLECTION_COLOURS = [
  "#9A3412",
  "#B45309",
  "#047857",
  "#0F766E",
  "#1D4ED8",
  "#7C3AED",
  "#BE185D",
  "#57534E",
];

export function CollectionMenu({
  collection,
  onMove,
}: {
  collection: Collection;
  onMove?: (delta: -1 | 1) => void;
}) {
  const { updateCollection, deleteCollection } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="vl-collection-menu" ref={ref}>
      <button
        className="vl-icon-btn vl-small"
        aria-label={`${collection.name} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div role="menu" className="vl-menu vl-menu-right">
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              const name = window.prompt("Rename collection", collection.name);
              if (name?.trim()) await updateCollection(collection.id, { name: name.trim() });
            }}
          >
            Rename…
          </button>
          {onMove && (
            <>
              <button role="menuitem" onClick={() => onMove(-1)}>
                Move up
              </button>
              <button role="menuitem" onClick={() => onMove(1)}>
                Move down
              </button>
            </>
          )}
          <div className="vl-swatches" role="group" aria-label="Colour">
            {COLLECTION_COLOURS.map((c) => (
              <button
                key={c}
                role="menuitemradio"
                aria-checked={collection.color.toLowerCase() === c.toLowerCase()}
                aria-label={`Colour ${c}`}
                className="vl-swatch"
                style={{ background: c }}
                onClick={() => void updateCollection(collection.id, { color: c })}
              />
            ))}
          </div>
          <button
            role="menuitem"
            className="vl-danger"
            onClick={async () => {
              setOpen(false);
              if (
                window.confirm(`Delete “${collection.name}”? Its documents will be kept and become unfiled.`)
              )
                await deleteCollection(collection.id);
            }}
          >
            Delete collection
          </button>
        </div>
      )}
    </div>
  );
}
