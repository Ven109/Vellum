import { useDocSession } from "../state/session.js";

export function RightRail() {
  const { headings, editor, wordCount, openedWordCount } = useDocSession();
  const added = Math.max(0, wordCount - openedWordCount);

  function jump(pos: number) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .scrollIntoView()
      .run();
  }

  return (
    <aside className="vl-rail" aria-label="Document details">
      <section>
        <h2 className="vl-rail-heading">Outline</h2>
        {headings.length === 0 ? (
          <p className="vl-muted">Headings you add appear here.</p>
        ) : (
          <ol className="vl-outline">
            {headings.map((h) => (
              <li key={`${h.pos}`} style={{ paddingLeft: (h.level - 1) * 12 }}>
                <button onClick={() => jump(h.pos)}>{h.text || "Untitled section"}</button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <h2 className="vl-rail-heading">This session</h2>
        <p className="vl-stat">
          <strong>{added.toLocaleString()}</strong> words added
        </p>
      </section>
      <section>
        <h2 className="vl-rail-heading">Suggestions</h2>
        <p className="vl-muted">No pending suggestions.</p>
      </section>
    </aside>
  );
}
