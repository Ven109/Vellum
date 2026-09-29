import { useEffect } from "react";
import { useDocSession } from "../state/session.js";
import { CommentsSection } from "./Comments.js";
import { SuggestionsList } from "./SuggestionsList.js";

/**
 * Tracks which outline section is at the top of the viewport. Uses one scroll listener throttled to
 * animation frames and only measures heading nodes, so cost does not grow with document length.
 */
function useActiveHeading() {
  const editor = useDocSession((s) => s.editor);
  const headings = useDocSession((s) => s.headings);
  useEffect(() => {
    if (!editor) return;
    const scroller = editor.view.dom.closest(".vl-scroll");
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top + 96;
      let active = -1;
      headings.forEach((h, i) => {
        const dom = editor.view.nodeDOM(h.pos);
        if (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= top) active = i;
      });
      if (active === -1 && headings.length) active = 0;
      if (useDocSession.getState().activeHeading !== active)
        useDocSession.getState().update({ activeHeading: active });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [editor, headings]);
}

export function RightRail() {
  const { headings, editor, wordCount, openedWordCount, activeHeading } = useDocSession();
  const added = Math.max(0, wordCount - openedWordCount);
  useActiveHeading();

  function jump(pos: number) {
    if (!editor) return;
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start", behavior: "smooth" });
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
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
            {headings.map((h, i) => (
              <li key={`${h.pos}`} style={{ paddingLeft: (h.level - 1) * 12 }}>
                <button aria-current={i === activeHeading ? "true" : undefined} onClick={() => jump(h.pos)}>
                  {h.text || "Untitled section"}
                </button>
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
      <CommentsSection />
      <SuggestionsList />
    </aside>
  );
}
