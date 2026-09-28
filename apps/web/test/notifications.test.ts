import { beforeEach, describe, expect, it } from "vitest";
import { useNotifications } from "../src/state/notifications.js";
import type { CommentThread } from "@vellum/core";

const thread = (comments: CommentThread["comments"]): CommentThread => ({
  id: "thr_1",
  documentId: "doc_1",
  anchor: { start: "", end: "", quote: "q", prefix: "", suffix: "" },
  status: "open",
  orphaned: false,
  comments,
});

beforeEach(() => {
  localStorage.clear();
  useNotifications.setState({ items: [] });
});

describe("mention notifications", () => {
  it("notifies once for mentions of me by other people", () => {
    const c = {
      id: "cmt_1",
      authorId: "usr_ann",
      authorName: "Ann",
      body: "@You look?",
      mentions: ["usr_me"],
      createdAt: "2026-09-28T10:00:00Z",
    };
    const mine = {
      id: "cmt_2",
      authorId: "usr_me",
      authorName: "You",
      body: "@You note to self",
      mentions: ["usr_me"],
      createdAt: "2026-09-28T10:01:00Z",
    };
    const other = {
      id: "cmt_3",
      authorId: "usr_ann",
      authorName: "Ann",
      body: "@Bo",
      mentions: ["usr_bo"],
      createdAt: "2026-09-28T10:02:00Z",
    };
    useNotifications.getState().ingest("doc_1", [thread([c, mine, other])], "usr_me");
    useNotifications.getState().ingest("doc_1", [thread([c, mine, other])], "usr_me");
    const items = useNotifications.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ from: "Ann", threadId: "thr_1", read: false });
    useNotifications.getState().markAllRead();
    expect(useNotifications.getState().items[0]!.read).toBe(true);
    expect(JSON.parse(localStorage.getItem("vellum:notifications")!)).toHaveLength(1);
  });
});
