import { Archive } from "lucide-react";
import { useState } from "react";
import { SettingsLayout } from "../components/SettingsLayout.js";
import { downloadBlob, exportWorkspace } from "../data/export.js";
import { ImportCard } from "./ImportCard.js";
import { useApp } from "../state/app.js";

export function ExportSettingsPage() {
  const workspace = useApp((s) => s.workspace);
  const count = useApp((s) => s.documents.length);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  async function run() {
    setError(null);
    setFinished(false);
    setProgress({ done: 0, total: count });
    try {
      const blob = await exportWorkspace((done, total) => setProgress({ done, total }));
      const date = new Date().toISOString().slice(0, 10);
      const name = `${(workspace?.name ?? "vellum").replace(/[^\w-]+/g, "-").toLowerCase()}-${date}.zip`;
      downloadBlob(blob, name);
      setFinished(true);
    } catch {
      setError("The export didn't finish. Try again; if a document is stuck, open it once and retry.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <SettingsLayout title="Export and backup">
      <section className="vl-card" aria-labelledby="export-h">
        <h2 id="export-h">Export the workspace</h2>
        <p className="vl-muted">
          Download everything in “{workspace?.name}” as portable files: one Markdown file per document in a
          folder per collection, the images they use, and a vellum.json with the workspace’s metadata, house
          rules and voice settings. Keep it as a backup, or import it into another Vellum.
        </p>
        <button className="vl-btn vl-btn-primary" onClick={() => void run()} disabled={!!progress}>
          <Archive size={14} />{" "}
          {progress ? `Exporting ${progress.done} of ${progress.total}…` : "Export as .zip"}
        </button>
        {finished && (
          <p className="vl-muted" role="status">
            Export downloaded.
          </p>
        )}
        {error && (
          <p className="vl-auth-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <ImportCard />
    </SettingsLayout>
  );
}
