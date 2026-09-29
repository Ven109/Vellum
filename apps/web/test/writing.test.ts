import { addDays, dayKey } from "@vellum/core";
import type { WritingSession } from "@vellum/core";
import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbRepository } from "../src/data/idb.js";
import { useApp } from "../src/state/app.js";
import { useWriting } from "../src/state/writing.js";

const at = (day: string, time = "12:00:00") => new Date(`${day}T${time}`).toISOString();
const session = (day: string, words: number): WritingSession => ({
  id: `ses_${day}_${words}`,
  userId: "u",
  documentId: "doc_1",
  collectionId: null,
  startedAt: at(day, "11:00:00"),
  endedAt: at(day),
  wordsAdded: words,
  wordsRemoved: 0,
  activeMs: 30 * 60_000,
});

beforeEach(async () => {
  useApp.setState({
    repo: new IndexedDbRepository(`test-${Math.random()}`),
    ready: false,
    documents: [],
    account: null,
  });
  useWriting.setState({ loaded: false, liveWords: 0 });
  await useApp.getState().init();
});

describe("goals and streaks", () => {
  it("keeps sessions on the device and rolls them up into today and the streak", async () => {
    const today = dayKey(new Date());
    const repo = useApp.getState().repo;
    await repo.putSession(session(addDays(today, -1), 600));
    await repo.putSession(session(addDays(today, -2), 300));
    await repo.putSession(session(addDays(today, -2), 250));
    await repo.putSession(session(addDays(today, -40), 900));
    await useWriting.getState().setGoal(500);
    expect(useWriting.getState()).toMatchObject({ goal: 500, todayWords: 0, streak: 2, metToday: false });

    await useWriting.getState().saveSession({ ...session(today, 520), endedAt: new Date().toISOString() });
    expect(useWriting.getState()).toMatchObject({ todayWords: 520, streak: 3, metToday: true });

    const range = await repo.listSessions(at(addDays(today, -3)), new Date().toISOString());
    expect(range).toHaveLength(4);
  });

  it("remembers the goal", async () => {
    await useWriting.getState().setGoal(750.6);
    expect(await useApp.getState().repo.getSetting("dailyGoal")).toBe(751);
  });
});
