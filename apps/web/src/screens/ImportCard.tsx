import { FileUp, FolderUp } from "lucide-react";
import { useRef, useState } from "react";
import { createImportedDocs } from "../data/import-runner.js";
import { convertFiles, readFiles } from "../data/importers.js";
import type { ImportResult } from "../data/importers.js";
import { navigate } from "../state/router.js";

type Phase =
  | { name: "idle" }
  | { name: "reading" }
  | { name: "review"; result: ImportResult }
  | { name: "importing"; done: number; total: number }
  | { name: "finished"; count: number; skipped: ImportResult["skipped"] };

/** Import Markdown files or folders, a Notion export or Google Docs files as drafts. */
export function ImportCard() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setPhase({ name: "reading" });
    try {
      const result = await convertFiles(await readFiles(Array.from(list)));
      setPhase({ name: "review", result });
    } catch {
      setError("Couldn't read those files. If it's a zip, check it isn't damaged.");
      setPhase({ name: "idle" });
    }
  }

  async function run(result: ImportResult) {
    const total = result.docs.length;
    setPhase({ name: "importing", done: 0, total });
    await createImportedDocs(result.docs, (done) => setPhase({ name: "importing", done, total }));
    setPhase({ name: "finished", count: total, skipped: result.skipped });
  }

  return (
    <section className="vl-card" aria-labelledby="import-h">
      <h2 id="import-h">Import</h2>
      <p className="vl-muted">
        Bring in Markdown files or folders, a Notion export (Markdown &amp; CSV .zip), or Google Docs saved as
        a web page (.html or .zip) or Word (.docx). Headings, emphasis, links and images come across; each
        file becomes a draft and folders become collections.
      </p>
      <div className="vl-import-actions">
        <button
          className="vl-btn"
          onClick={() => filesRef.current?.click()}
          disabled={phase.name === "importing"}
        >
          <FileUp size={14} /> Choose files
        </button>
        <button
          className="vl-btn"
          onClick={() => folderRef.current?.click()}
          disabled={phase.name === "importing"}
        >
          <FolderUp size={14} /> Choose a folder
        </button>
        <input
          ref={filesRef}
          type="file"
          hidden
          multiple
          aria-label="Files to import"
          accept=".md,.markdown,.txt,.html,.htm,.zip,.docx"
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={(el) => {
            folderRef.current = el;
            el?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          hidden
          multiple
          aria-label="Folder to import"
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p className="vl-auth-error" role="alert">
          {error}
        </p>
      )}
      {phase.name === "reading" && <p className="vl-muted">Reading files…</p>}
      {phase.name === "review" && (
        <div className="vl-import-review" data-testid="import-review">
          {phase.result.docs.length === 0 ? (
            <p>Nothing to import in those files.</p>
          ) : (
            <>
              <p>
                Ready to import {phase.result.docs.length}{" "}
                {phase.result.docs.length === 1 ? "draft" : "drafts"}:
              </p>
              <ul className="vl-import-list">
                {phase.result.docs.slice(0, 50).map((d) => (
                  <li key={d.source}>
                    <strong>{d.title}</strong>
                    {d.folder && <span className="vl-muted"> · {d.folder}</span>}
                  </li>
                ))}
                {phase.result.docs.length > 50 && (
                  <li className="vl-muted">and {phase.result.docs.length - 50} more</li>
                )}
              </ul>
            </>
          )}
          <Skipped skipped={phase.result.skipped} />
          <div className="vl-import-actions">
            {phase.result.docs.length > 0 && (
              <button className="vl-btn vl-btn-primary" onClick={() => void run(phase.result)}>
                Import
              </button>
            )}
            <button className="vl-btn" onClick={() => setPhase({ name: "idle" })}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {phase.name === "importing" && (
        <p role="status">
          Importing {phase.done} of {phase.total}…
        </p>
      )}
      {phase.name === "finished" && (
        <div role="status">
          <p>
            Imported {phase.count} {phase.count === 1 ? "draft" : "drafts"}.{" "}
            <button className="vl-link vl-inline-link" onClick={() => navigate("/library")}>
              Open the library
            </button>
          </p>
          <Skipped skipped={phase.skipped} />
        </div>
      )}
    </section>
  );
}

function Skipped({ skipped }: { skipped: ImportResult["skipped"] }) {
  if (!skipped.length) return null;
  return (
    <details className="vl-import-skipped">
      <summary>
        {skipped.length} {skipped.length === 1 ? "file" : "files"} skipped
      </summary>
      <ul>
        {skipped.map((s) => (
          <li key={s.path}>
            {s.path} — {s.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}
