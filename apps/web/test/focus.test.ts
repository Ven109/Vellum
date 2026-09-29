import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock } from "../src/components/FocusHud.js";
import { sprintRemaining, useFocus } from "../src/state/focus.js";
import { useDocSession } from "../src/state/session.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T09:00:00Z"));
  useDocSession.setState({ wordCount: 100 });
  useFocus.setState({ active: false, sprint: null });
});
afterEach(() => vi.useRealTimers());

describe("focus mode", () => {
  it("counts words written since entering", () => {
    useFocus.getState().enter();
    expect(useFocus.getState()).toMatchObject({ active: true, startWords: 100 });
    useFocus.getState().toggle();
    expect(useFocus.getState().active).toBe(false);
  });

  it("runs, pauses, resumes and finishes a sprint", () => {
    useFocus.getState().enter();
    useFocus.getState().startSprint(10);
    vi.advanceTimersByTime(4 * 60_000);
    expect(sprintRemaining(useFocus.getState().sprint!)).toBe(6 * 60_000);

    useFocus.getState().pauseSprint();
    vi.advanceTimersByTime(30 * 60_000);
    expect(sprintRemaining(useFocus.getState().sprint!)).toBe(6 * 60_000);

    useFocus.getState().resumeSprint();
    useDocSession.setState({ wordCount: 340 });
    vi.advanceTimersByTime(6 * 60_000);
    useFocus.getState().tick();
    expect(useFocus.getState().sprint).toMatchObject({ finished: true, wordsWritten: 240, remainingMs: 0 });
  });

  it("remembers dimming and goal", () => {
    useFocus.getState().setDimming("typewriter");
    useFocus.getState().setGoal(750.4);
    expect(JSON.parse(localStorage.getItem("vellum:focus")!)).toEqual({ dimming: "typewriter", goal: 750 });
  });

  it("formats clocks", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});
