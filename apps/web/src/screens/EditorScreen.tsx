import { useEffect, useRef, useState } from "react";
import { acquireDoc, releaseDoc, titleOf } from "../data/ydocs.js";
import type { LiveDoc } from "../data/ydocs.js";
import { WELCOME_MARKDOWN } from "../data/seed.js";
import { DocumentEditor } from "../editor/DocumentEditor.js";
import { RightRail } from "../components/RightRail.js";
import { TopBar } from "../components/TopBar.js";
import { useApp } from "../state/app.js";

function useLiveDoc(id: string): LiveDoc | null {
  const [live, setLive] = useState<LiveDoc | null>(null);
  useEffect(() => {
    let cancelled = false;
    const entry = acquireDoc(id);
    void entry.whenLoaded.then(() => !cancelled && setLive(entry));
    return () => {
      cancelled = true;
      setLive(null);
      releaseDoc(id);
    };
  }, [id]);
  return live;
}

function TitleField({ live, docId }: { live: LiveDoc; docId: string }) {
  const meta = useApp((s) => s.documents.find((d) => d.id === docId));
  const updateDocument = useApp((s) => s.updateDocument);
  const ytitle = titleOf(live.doc);
  const [value, setValue] = useState(() => ytitle.toString() || meta?.title || "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!ytitle.length && meta?.title) ytitle.insert(0, meta.title);
    const observer = () => {
      const next = ytitle.toString();
      setValue(next);
      void updateDocument(docId, { title: next, updatedAt: new Date().toISOString() });
    };
    ytitle.observe(observer);
    return () => ytitle.unobserve(observer);
    // Seed only once per open document.
  }, [ytitle, docId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="vl-title"
      rows={1}
      placeholder="Untitled"
      aria-label="Title"
      value={value}
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, " ");
        live.doc.transact(() => {
          ytitle.delete(0, ytitle.length);
          ytitle.insert(0, next);
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (document.querySelector(".vl-prose") as HTMLElement | null)?.focus();
        }
      }}
    />
  );
}

export function EditorScreen({ docId }: { docId: string }) {
  const meta = useApp((s) => s.documents.find((d) => d.id === docId));
  const welcomeId = useApp((s) => s.welcomeDocId);
  const live = useLiveDoc(docId);

  if (!meta) {
    return (
      <main className="vl-main vl-empty">
        <p>This document doesn’t exist or was deleted.</p>
      </main>
    );
  }

  return (
    <>
      <main className="vl-main">
        <TopBar doc={meta} />
        <div className="vl-scroll">
          <article className="vl-column">
            {live ? (
              <>
                <TitleField live={live} docId={docId} />
                <DocumentEditor
                  key={docId}
                  docId={docId}
                  ydoc={live.doc}
                  initialMarkdown={docId === welcomeId ? WELCOME_MARKDOWN : undefined}
                />
              </>
            ) : (
              <p className="vl-muted" aria-busy="true">
                Opening…
              </p>
            )}
          </article>
        </div>
      </main>
      <RightRail />
    </>
  );
}
