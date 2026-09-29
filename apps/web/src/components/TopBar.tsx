import { formatReadingTime } from "@vellum/core";
import type { DocumentMeta } from "@vellum/core";
import {
  Check,
  CloudOff,
  History,
  Loader2,
  Maximize2,
  MessagesSquare,
  Mic,
  MoreHorizontal,
  Share2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toggleFocus } from "./CoreCommands.js";
import { historyPath, navigate, voicePath } from "../state/router.js";
import { ShareDialog } from "./ShareDialog.js";
import { usePeers } from "../state/presence.js";
import { useAssistant } from "../state/assistant.js";
import { ModeSwitch } from "./SuggestionsList.js";
import { useReview } from "./ReviewPanel.js";
import { useComments } from "../state/comments.js";
import { useSuggestions } from "../state/suggestions.js";
import { useState } from "react";
import { useApp } from "../state/app.js";
import { useDocSession } from "../state/session.js";
import { displayTitle } from "./Sidebar.js";
import { MenuButton } from "./MobileNav.js";

const SAVE_LABEL = {
  saved: { text: "Saved", icon: <Check size={14} />, hint: "All changes saved." },
  saving: {
    text: "Saving…",
    icon: <Loader2 size={14} className="vl-spin" />,
    hint: "Saving your latest changes.",
  },
  offline: {
    text: "Offline",
    icon: <CloudOff size={14} />,
    hint: "Saved on this device. Changes will sync when the connection is back.",
  },
  error: {
    text: "Not saved",
    icon: <TriangleAlert size={14} />,
    hint: "Changes could not be written to this device's storage. Copy your work somewhere safe.",
  },
} as const;

export function TopBar({ doc }: { doc: DocumentMeta }) {
  const collection = useApp((s) => s.collections.find((c) => c.id === doc.collectionId));
  const user = useApp((s) => s.user);
  const wordCount = useDocSession((s) => s.wordCount);
  const stats = useDocSession((s) => s.stats);
  const [statsOpen, setStatsOpen] = useState(false);
  const saveState = useDocSession((s) => s.saveState);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const awareness = useDocSession((s) => s.awareness);
  const peers = usePeers(awareness, user?.id);
  const role = useSuggestions((s) => s.role);
  const assistantOpen = useAssistant((s) => s.open);
  const reviewOpen = useReview((s) => s.open);
  const reviewCount =
    useComments((s) => s.threads.filter((t) => t.status === "open").length) +
    useSuggestions((s) => s.items.length);
  const save = SAVE_LABEL[saveState];

  return (
    <header className="vl-topbar">
      <MenuButton />
      <nav aria-label="Breadcrumb" className="vl-breadcrumb">
        <span>{collection?.name ?? "Unfiled"}</span>
        <span aria-hidden>/</span>
        <span className="vl-crumb-current" aria-current="page">
          {displayTitle(doc.title)}
        </span>
      </nav>
      <div className="vl-topbar-right">
        <span className={`vl-save vl-save-${saveState}`} role="status" aria-live="polite" title={save.hint}>
          {save.icon}
          {save.text}
        </span>
        <span className="vl-wide-only vl-mode-wrap">
          <ModeSwitch />
        </span>
        <div className="vl-stats-wrap">
          <button
            className="vl-wordcount"
            data-testid="word-count"
            aria-expanded={statsOpen}
            aria-haspopup="dialog"
            onClick={() => setStatsOpen((o) => !o)}
          >
            {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}
          </button>
          <span className="vl-readtime">{formatReadingTime(stats.readingMinutes)}</span>
          {statsOpen && (
            <div className="vl-popover" role="dialog" aria-label="Document statistics">
              <dl>
                <dt>Words</dt>
                <dd>{stats.words.toLocaleString()}</dd>
                <dt>Characters</dt>
                <dd>{stats.characters.toLocaleString()}</dd>
                <dt>Characters without spaces</dt>
                <dd>{stats.charactersNoSpaces.toLocaleString()}</dd>
                <dt>Reading time</dt>
                <dd>{formatReadingTime(stats.readingMinutes)}</dd>
              </dl>
            </div>
          )}
        </div>
        <ul className="vl-avatars" aria-label="People in this document">
          {user && (
            <li className="vl-avatar" style={{ background: user.avatarColor }} title={`${user.name} (you)`}>
              {user.name.slice(0, 1)}
            </li>
          )}
          {peers.slice(0, 4).map((p) => (
            <li key={p.id} className="vl-avatar vl-peer" style={{ background: p.color }} title={p.name}>
              {p.name.slice(0, 1).toUpperCase()}
            </li>
          ))}
          {peers.length > 4 && (
            <li
              className="vl-avatar vl-avatar-more"
              title={peers
                .slice(4)
                .map((p) => p.name)
                .join(", ")}
            >
              +{peers.length - 4}
            </li>
          )}
        </ul>
        {role !== "owner" && role !== "edit" && (
          <span className="vl-role-badge" data-testid="role-badge">
            {role === "view" ? "Viewing" : role === "comment" ? "Commenting" : "Suggesting"}
          </span>
        )}
        <button
          className="vl-btn"
          aria-label={reviewCount > 0 ? `Review, ${reviewCount} open` : "Review"}
          aria-pressed={reviewOpen}
          onClick={() => {
            useAssistant.getState().setOpen(false);
            useReview.getState().setOpen(!reviewOpen);
          }}
        >
          <MessagesSquare size={14} /> <span className="vl-btn-label">Review</span>
          {reviewCount > 0 && <span className="vl-count-pill">{reviewCount}</span>}
        </button>
        <button
          className="vl-btn"
          aria-label="Voice session"
          title="Talk it through"
          onClick={() => navigate(voicePath(doc.id))}
        >
          <Mic size={14} /> <span className="vl-btn-label">Voice</span>
        </button>
        <button
          className="vl-btn"
          aria-label="Assistant"
          aria-pressed={assistantOpen}
          title="Assistant (Ctrl/⌘ J)"
          onClick={() => {
            useReview.getState().setOpen(false);
            useAssistant.getState().toggle();
          }}
        >
          <Sparkles size={14} /> <span className="vl-btn-label">Assistant</span>
        </button>
        <div className="vl-more-wrap">
          <button
            className="vl-icon-btn"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <MoreHorizontal size={18} />
          </button>
          {moreOpen && (
            <ul role="menu" className="vl-menu vl-more-menu">
              <li role="none" className="vl-more-mode">
                <ModeSwitch />
              </li>
              <li role="none">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(historyPath(doc.id));
                  }}
                >
                  <History size={15} /> Version history
                </button>
              </li>
              <li role="none">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    toggleFocus();
                  }}
                >
                  <Maximize2 size={15} /> Focus mode
                </button>
              </li>
            </ul>
          )}
        </div>
        <button
          className="vl-icon-btn vl-wide-only"
          aria-label="Version history"
          title="Version history"
          onClick={() => navigate(historyPath(doc.id))}
        >
          <History size={15} />
        </button>
        <button
          className="vl-icon-btn vl-wide-only"
          aria-label="Focus mode"
          title="Focus mode (Ctrl/⌘ Shift F)"
          onClick={toggleFocus}
        >
          <Maximize2 size={15} />
        </button>
        <div className="vl-share-wrap">
          <button
            className="vl-btn vl-btn-primary"
            aria-label="Share"
            aria-expanded={shareOpen}
            aria-haspopup="dialog"
            onClick={() => setShareOpen((o) => !o)}
          >
            <Share2 size={14} /> <span className="vl-btn-label">Share</span>
          </button>
          {shareOpen && <ShareDialog doc={doc} onClose={() => setShareOpen(false)} />}
        </div>
      </div>
    </header>
  );
}
