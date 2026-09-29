import type { DocumentMeta } from "@vellum/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { account } from "../data/account.js";
import { canEdit, useSuggestions } from "../state/suggestions.js";
import { acquireDoc, releaseDoc, titleOf } from "../data/ydocs.js";
import type { LiveDoc } from "../data/ydocs.js";
import { WELCOME_MARKDOWN } from "../data/seed.js";
import { DocumentEditor } from "../editor/DocumentEditor.js";
import { AssistantPanel } from "../components/AssistantPanel.js";
import { ProposalCard } from "../components/ProposalCard.js";
import { CommentComposer } from "../components/Comments.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { ReviewPanel, useReview } from "../components/ReviewPanel.js";
import { RightRail } from "../components/RightRail.js";
import { useAssistant } from "../state/assistant.js";
import { TopBar } from "../components/TopBar.js";
import { FocusHud } from "../components/FocusHud.js";
import { useFocus } from "../state/focus.js";
import { usePreferences } from "../state/preferences.js";
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
          This document was changed elsewhere while you were away. Both sets of changes were merged, and your
          version from before the merge is saved in History.
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

function TitleField({ live, docId, meta }: { live: LiveDoc; docId: string; meta?: DocumentMeta }) {
  const role = useSuggestions((s) => s.role);
  const spellcheck = usePreferences((s) => s.prefs.spellcheck);
  const shared = useApp((s) => s.shared.some((d) => d.docId === docId));
  const updateDocument = useApp((s) => s.updateDocument);
  const ytitle = titleOf(live.doc);
  const [value, setValue] = useState(() => ytitle.toString() || meta?.title || "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Seed the title from metadata for documents created before titles lived in the CRDT. Shared
    // documents get theirs from the server.
    if (!ytitle.length && meta?.title && !shared) ytitle.insert(0, meta.title);
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
      spellCheck={spellcheck}
      readOnly={!canEdit(role)}
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

function DocumentPane({ docId, primary, meta }: { docId: string; primary: boolean; meta?: DocumentMeta }) {
  const welcomeId = useApp((s) => s.welcomeDocId);
  const live = useLiveDoc(docId, primary);
  return (
    <article className="vl-column">
      {live ? (
        <>
          <Notices live={live} />
          <TitleField live={live} docId={docId} meta={meta} />
          <DocumentEditor
            key={docId}
            docId={docId}
            ydoc={live.doc}
            awareness={live.awareness}
            live={live}
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

/** Your role on the open document: from the server when signed in, otherwise it's yours. */
function useDocAccess(docId: string) {
  useEffect(() => {
    let cancelled = false;
    const { account: me, shared } = useApp.getState();
    const sharedRole = shared.find((d) => d.docId === docId)?.role;
    useSuggestions.setState({ role: sharedRole ?? "owner" });
    if (!me) return;
    account.access(docId).then(
      (r) => {
        // Not on the server yet means it's a new document of yours.
        if (!cancelled && r.registered) useSuggestions.setState({ role: r.role ?? "view" });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [docId]);
}

/** Metadata for a document someone shared with you (it isn't in your own library). */
function useMeta(docId: string): DocumentMeta | undefined {
  const own = useApp((s) => s.documents.find((d) => d.id === docId));
  const shared = useApp((s) => s.shared.find((d) => d.docId === docId));
  return useMemo(() => {
    if (own || !shared) return own;
    return {
      id: shared.docId,
      workspaceId: shared.workspaceId,
      collectionId: null,
      title: shared.title,
      status: "draft",
      ownerId: "",
      isTemplate: false,
      tags: [],
      wordCount: 0,
      createdAt: "",
      updatedAt: "",
    } satisfies DocumentMeta;
  }, [own, shared]);
}

export function EditorScreen({ docId, splitId }: { docId: string; splitId?: string }) {
  const meta = useMeta(docId);
  useDocAccess(docId);
  const splitMeta = useApp((s) => (splitId ? s.documents.find((d) => d.id === splitId) : undefined));
  const assistantOpen = useAssistant((s) => s.open);
  const reviewOpen = useReview((s) => s.open);
  const focus = useFocus((s) => s.active);
  const inlineProposals = useApp((s) => s.workspace?.settings.behaviour.inlineSuggestions ?? true);
  const dimming = useFocus((s) => s.dimming);
  // Leaving the document leaves focus mode.
  useEffect(() => () => useFocus.getState().exit(), [docId]);

  if (!meta) {
    return (
      <main className="vl-main vl-empty">
        <p>This document doesn’t exist or was deleted.</p>
      </main>
    );
  }

  if (splitId && splitMeta && splitId !== docId) {
    return (
      <main className="vl-main" data-focus={focus || undefined} data-dimming={focus ? dimming : undefined}>
        {!focus && <TopBar doc={meta} />}
        <div className="vl-split">
          <section className="vl-scroll" aria-label="Primary document">
            <DocumentPane docId={docId} primary meta={meta} />
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
        {focus && <FocusHud />}
      </main>
    );
  }

  return (
    <>
      <main
        className="vl-main"
        data-focus={focus || undefined}
        data-dimming={focus ? dimming : undefined}
        data-inline-proposals={inlineProposals ? undefined : "off"}
      >
        {!focus && <TopBar doc={meta} />}
        <div className="vl-scroll">
          <DocumentPane docId={docId} primary meta={meta} />
        </div>
        {focus && <FocusHud />}
      </main>
      <ErrorBoundary label="the side panel">
        {assistantOpen ? <AssistantPanel /> : focus ? null : reviewOpen ? <ReviewPanel /> : <RightRail />}
      </ErrorBoundary>
      <ProposalCard />
      <CommentComposer />
    </>
  );
}
