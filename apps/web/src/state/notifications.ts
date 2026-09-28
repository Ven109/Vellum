import type { CommentThread } from "@vellum/core";
import { create } from "zustand";

/**
 * In-app notifications (mentions). Stored per browser. With accounts on a server (VEL-36), the server
 * also records mentions for people who are offline; this store is what the client shows.
 */
export interface AppNotification {
  id: string;
  kind: "mention";
  docId: string;
  threadId: string;
  from: string;
  excerpt: string;
  at: string;
  read: boolean;
}

const KEY = "vellum:notifications";

function load(): AppNotification[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as AppNotification[];
  } catch {
    return [];
  }
}

function save(list: AppNotification[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* storage unavailable */
  }
}

interface NotificationsState {
  items: AppNotification[];
  ingest(docId: string, threads: CommentThread[], meId: string): void;
  markRead(id: string): void;
  markAllRead(): void;
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  items: load(),
  ingest(docId, threads, meId) {
    const known = new Set(get().items.map((n) => n.id));
    const added: AppNotification[] = [];
    for (const t of threads)
      for (const c of t.comments) {
        if (c.authorId === meId || !c.mentions.includes(meId) || known.has(c.id)) continue;
        added.push({
          id: c.id,
          kind: "mention",
          docId,
          threadId: t.id,
          from: c.authorName ?? "Someone",
          excerpt: c.body.slice(0, 140),
          at: c.createdAt,
          read: false,
        });
      }
    if (!added.length) return;
    const items = [...added, ...get().items].sort((a, b) => b.at.localeCompare(a.at));
    save(items);
    set({ items });
  },
  markRead(id) {
    const items = get().items.map((n) => (n.id === id ? { ...n, read: true } : n));
    save(items);
    set({ items });
  },
  markAllRead() {
    const items = get().items.map((n) => ({ ...n, read: true }));
    save(items);
    set({ items });
  },
}));
