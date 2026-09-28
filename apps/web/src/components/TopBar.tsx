import { formatReadingTime } from "@vellum/core";
import type { DocumentMeta } from "@vellum/core";
import { Check, CloudOff, Loader2, Share2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useApp } from "../state/app.js";
import { useDocSession } from "../state/session.js";
import { displayTitle } from "./Sidebar.js";

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
  const [copied, setCopied] = useState(false);
  const save = SAVE_LABEL[saveState];

  async function share() {
    await navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <header className="vl-topbar">
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
        <div className="vl-avatars" aria-label="People in this document">
          {user && (
            <span className="vl-avatar" style={{ background: user.avatarColor }} title={user.name}>
              {user.name.slice(0, 1)}
            </span>
          )}
        </div>
        <button className="vl-btn vl-btn-primary" onClick={() => void share()}>
          <Share2 size={14} /> {copied ? "Link copied" : "Share"}
        </button>
      </div>
    </header>
  );
}
