import { FileDown } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createImportedDocs } from "../data/import-runner.js";
import { convertFiles, readFiles } from "../data/importers.js";
import type { ImportResult, SourceFile } from "../data/importers.js";
import { docPath, navigate } from "../state/router.js";

const IMPORTABLE = /\.(md|markdown|txt|html?|zip|docx)$/i;

interface ImportDropState {
  review: ImportResult | null;
  busy: boolean;
  error: string | null;
  /** Show the review for files dropped on the window, opened with the app, or dropped on its icon. */
  start(files: SourceFile[]): Promise<void>;
  close(): void;
}

export const useImportDrop = create<ImportDropState>((set) => ({
  review: null,
  busy: false,
  error: null,
  async start(files) {
    set({ busy: true, error: null });
    try {
      set({ review: await convertFiles(files), busy: false });
    } catch {
      set({ busy: false, error: "Couldn't read those files." });
    }
  },
  close() {
    set({ review: null, error: null, busy: false });
  },
}));

/**
 * Drop Markdown, Notion or Google Docs files anywhere on the window to import them. Images dropped into
 * the text are left to the editor.
 */
export function ImportDrop() {
  const { review, busy, error, start, close } = useImportDrop();
  const [over, setOver] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onlyImages = (e: DragEvent) =>
      Array.from(e.dataTransfer?.items ?? []).every((i) => i.kind !== "file" || i.type.startsWith("image/"));
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || onlyImages(e)) return;
      depth++;
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e) || onlyImages(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e) && !onlyImages(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => IMPORTABLE.test(f.name));
      if (!files.length) return;
      // Ours, not the editor's and not the browser's (which would open the file).
      e.preventDefault();
      e.stopPropagation();
      void readFiles(files).then(start);
    };
    window.addEventListener("dragenter", onEnter, true);
    window.addEventListener("dragleave", onLeave, true);
    window.addEventListener("dragover", onOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onEnter, true);
      window.removeEventListener("dragleave", onLeave, true);
      window.removeEventListener("dragover", onOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [start]);

  async function run(result: ImportResult) {
    setImporting(true);
    const ids = await createImportedDocs(result.docs);
    setImporting(false);
    close();
    if (ids.length === 1) navigate(docPath(ids[0]!));
    else navigate("/library");
  }

  return (
    <>
      {over && (
        <div className="vl-drop-overlay" aria-hidden>
          <FileDown size={28} />
          <p>Drop to import</p>
        </div>
      )}
      {(review || busy || error) && (
        <div className="vl-modal-backdrop">
          <div className="vl-modal" role="dialog" aria-label="Import files">
            <h2>Import</h2>
            {busy && <p className="vl-muted">Reading files…</p>}
            {error && (
              <p className="vl-auth-error" role="alert">
                {error}
              </p>
            )}
            {review && (
              <>
                {review.docs.length === 0 ? (
                  <p>Nothing to import in those files.</p>
                ) : (
                  <>
                    <p>
                      Import {review.docs.length} {review.docs.length === 1 ? "draft" : "drafts"}:
                    </p>
                    <ul className="vl-import-list">
                      {review.docs.map((d) => (
                        <li key={d.source}>
                          <strong>{d.title}</strong>
                          {d.folder && <span className="vl-muted"> · {d.folder}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {review.skipped.length > 0 && (
                  <p className="vl-muted">
                    {review.skipped.length} {review.skipped.length === 1 ? "file" : "files"} skipped.
                  </p>
                )}
              </>
            )}
            <div className="vl-actions">
              {review && review.docs.length > 0 && (
                <button
                  className="vl-btn vl-btn-primary"
                  disabled={importing}
                  onClick={() => void run(review)}
                >
                  {importing ? "Importing…" : "Import"}
                </button>
              )}
              <button className="vl-btn" onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
