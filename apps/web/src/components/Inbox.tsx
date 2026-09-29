import { relativeTime } from "@vellum/core";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useComments } from "../state/comments.js";
import { useNotifications } from "../state/notifications.js";
import { docPath, navigate } from "../state/router.js";

export function Inbox() {
  const { items, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="vl-inbox" ref={ref}>
      <button
        className="vl-icon-btn"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={16} />
        {unread > 0 && <span className="vl-badge">{unread}</span>}
      </button>
      {open && (
        <div className="vl-menu vl-inbox-menu" role="dialog" aria-label="Notifications">
          <div className="vl-inbox-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="vl-link" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="vl-muted">Nothing yet. You’ll see it here when someone @mentions you.</p>
          ) : (
            <ul>
              {items.slice(0, 30).map((n) => (
                <li key={n.id}>
                  <button
                    data-unread={!n.read || undefined}
                    onClick={() => {
                      markRead(n.id);
                      setOpen(false);
                      navigate(docPath(n.docId));
                      setTimeout(() => useComments.getState().setActive(n.threadId), 300);
                    }}
                  >
                    <strong>{n.from}</strong> mentioned you
                    <span className="vl-muted"> · {relativeTime(n.at)}</span>
                    <span className="vl-inbox-excerpt">{n.excerpt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
