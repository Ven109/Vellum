import { useEffect, useRef, useState } from "react";
import { acquireDoc, releaseDoc, titleOf } from "../data/ydocs.js";
import type { LiveDoc } from "../data/ydocs.js";
import { WELCOME_MARKDOWN } from "../data/seed.js";
import { DocumentEditor } from "../editor/DocumentEditor.js";
import { AssistantPanel } from "../components/AssistantPanel.js";
import { ProposalCard } from "../components/ProposalCard.js";
import { CommentComposer } from "../components/Comments.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { RightRail } from "../components/RightRail.js";
import { useAssistant } from "../state/assistant.js";
import { TopBar } from "../components/TopBar.js";
import { X } from "lucide-react";
import { displayTitle } from "../components/Sidebar.js";
import { useApp } from "../state/app.js";
import { docPath, navigate } from "../state/router.js";
import { useDocSession } from "../state/session.js";

function useLiveDoc(id: string, primary = true): LiveDoc | null {
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
  useEffect(() => {
    if (!live || !primary) return;
    const push = () => useDocSession.getState().update({ saveState: live.saveState });
    push();
    return live.onStatus(push);
  }, [live, primary]);
  return live;
}

function Notices({ live }: { live: LiveDoc }) {
  const [recovered, setRecovered] = useState(live.recovered);
  const [merged, setMerged] = useState(false);
  useEffect(() => live.onMerged(() => setMerged(true)), [live]);
  if (!recovered && !merged) return null;
  return (
    <div className="vl-notice" role="status">
      {recovered ? (
        <span>
          We recovered edits from your last session that hadn’t reached the server. They’re being synced now.
        </span>
      ) : (
        <span>
          This document was changed elsewhere while you were away. Both sets of changes were merged — nothing
          was lost.
        </span>
      )}
      <button
        className="vl-btn"
        onClick={() => {
          setRecovered(false);
          setMerged(false);
        }}
      >
        Dismiss
      </button>
    </div>
  );
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
    // Catch up with anything that arrived (local load or server sync) between render and subscribe.
    setValue(ytitle.toString() || meta?.title || "");
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
          (e.currentTarget.closest("article")?.querySelector(".vl-prose") as HTMLElement | null)?.focus();
        }
      }}
    />
  );
}

function DocumentPane({ docId, primary }: { docId: string; primary: boolean }) {
  const welcomeId = useApp((s) => s.welcomeDocId);
  const live = useLiveDoc(docId, primary);
  return (
    <article className="vl-column">
      {live ? (
        <>
          <Notices live={live} />
          <TitleField live={live} docId={docId} />
          <DocumentEditor
            key={docId}
            docId={docId}
            ydoc={live.doc}
            primary={primary}
            initialMarkdown={docId === welcomeId ? WELCOME_MARKDOWN : undefined}
          />
        </>
      ) : (
        <p className="vl-muted" aria-busy="true">
          Opening…
        </p>
      )}
    </article>
  );
}

export function EditorScreen({ docId, splitId }: { docId: string; splitId?: string }) {
  const meta = useApp((s) => s.documents.find((d) => d.id === docId));
  const splitMeta = useApp((s) => (splitId ? s.documents.find((d) => d.id === splitId) : undefined));
  const assistantOpen = useAssistant((s) => s.open);

  if (!meta) {
    return (
      <main className="vl-main vl-empty">
        <p>This document doesn’t exist or was deleted.</p>
      </main>
    );
  }

  if (splitId && splitMeta && splitId !== docId) {
    return (
      <main className="vl-main">
        <TopBar doc={meta} />
        <div className="vl-split">
          <section className="vl-scroll" aria-label="Primary document">
            <DocumentPane docId={docId} primary />
          </section>
          <section
            className="vl-scroll vl-split-secondary"
            aria-label={`Split: ${displayTitle(splitMeta.title)}`}
          >
            <div className="vl-split-bar">
              <span>{displayTitle(splitMeta.title)}</span>
              <button
                className="vl-icon-btn"
                aria-label="Close split"
                onClick={() => navigate(docPath(docId))}
              >
                <X size={16} />
              </button>
            </div>
            <DocumentPane docId={splitId} primary={false} />
          </section>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="vl-main">
        <TopBar doc={meta} />
        <div className="vl-scroll">
          <DocumentPane docId={docId} primary />
        </div>
      </main>
      <ErrorBoundary label="the side panel">
        {assistantOpen ? <AssistantPanel /> : <RightRail />}
      </ErrorBoundary>
      <ProposalCard />
      <CommentComposer />
    </>
  );
}
