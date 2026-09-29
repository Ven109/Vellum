import { Flame, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../state/app.js";
import { STREAK_RULE, useWriting } from "../state/writing.js";

/** Today's words against the daily goal, and the current streak. Private to this device. */
export function GoalMeter() {
  const ready = useApp((s) => s.ready);
  const { goal, todayWords, liveWords, streak, loaded, load, setGoal } = useWriting();
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (ready && !loaded) void load();
  }, [ready, loaded, load]);

  const today = todayWords + liveWords;
  const pct = Math.min(100, Math.round((today / goal) * 100));
  const done = today >= goal;

  return (
    <section className="vl-goal" aria-label="Daily goal" title="Only on this device — never uploaded.">
      <div className="vl-goal-row">
        <Target size={13} aria-hidden />
        <span data-testid="goal-progress">
          {today.toLocaleString()} / {goal.toLocaleString()} words today
        </span>
        <button className="vl-link" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? "Close" : "Goal"}
        </button>
      </div>
      <div
        className="vl-goal-bar"
        data-done={done || undefined}
        role="progressbar"
        aria-label="Progress towards today's goal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="vl-goal-streak" title={STREAK_RULE} data-testid="streak">
        <Flame size={12} aria-hidden /> {streak === 1 ? "1-day streak" : `${streak}-day streak`}
      </p>
      {editing && (
        <form
          className="vl-goal-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(new FormData(e.currentTarget).get("goal"));
            if (v > 0) void setGoal(v).then(() => setEditing(false));
          }}
        >
          <label>
            Daily goal
            <input className="vl-input" name="goal" type="number" min={1} max={100000} defaultValue={goal} />
          </label>
          <button className="vl-btn">Save</button>
          <p className="vl-muted">{STREAK_RULE}</p>
        </form>
      )}
    </section>
  );
}
