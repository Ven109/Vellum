import { addDays, dayKey, readability, summarize, insightsCsv } from "@vellum/core";
import type { InsightsSummary, WritingSession } from "@vellum/core";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadSearchIndex } from "../data/search.js";
import { displayTitle } from "../components/Sidebar.js";
import { useApp } from "../state/app.js";
import { STREAK_RULE, useWriting } from "../state/writing.js";

type Range = "7d" | "30d" | "year";
const RANGES: Array<{ id: Range; label: string; days: number }> = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "year", label: "Year", days: 365 },
];

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const shortDate = (day: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, opts);

function Chart({ summary, goal, range }: { summary: InsightsSummary; goal: number; range: Range }) {
  const days = summary.days;
  const max = Math.max(goal, ...days.map((d) => d.words), 1);
  const W = 720;
  const H = 180;
  const gap = days.length > 60 ? 0.5 : 3;
  const bw = W / days.length - gap;
  const goalY = H - (goal / max) * H;
  const labelEvery = range === "7d" ? 1 : range === "30d" ? 5 : 30;
  return (
    <figure className="vl-chart">
      <svg
        viewBox={`0 0 ${W} ${H + 22}`}
        role="img"
        aria-label={`Words per day over ${days.length} days: ${summary.words.toLocaleString()} in total, goal met on ${summary.goalDays} days.`}
      >
        {days.map((d, i) => {
          const h = (d.words / max) * H;
          const met = goal > 0 && d.words >= goal;
          const x = i * (bw + gap);
          return (
            <g key={d.day}>
              <rect
                x={x}
                y={H - h}
                width={Math.max(bw, 0.5)}
                height={Math.max(h, d.words ? 1 : 0)}
                rx={bw > 6 ? 2 : 0}
                className={met ? "vl-bar vl-bar-met" : "vl-bar"}
                data-testid="bar"
                data-met={met || undefined}
              >
                <title>
                  {shortDate(d.day, { weekday: "short", month: "short", day: "numeric" })}:{" "}
                  {d.words.toLocaleString()} words
                  {met ? " — goal met" : ""}
                </title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H + 16} textAnchor="middle" className="vl-chart-label">
                  {range === "year" ? shortDate(d.day, { month: "short" }) : shortDate(d.day)}
                </text>
              )}
            </g>
          );
        })}
        {goal > 0 && <line x1={0} x2={W} y1={goalY} y2={goalY} className="vl-goal-line" />}
      </svg>
      <figcaption className="vl-chart-legend">
        <span className="vl-swatch vl-bar-met" /> Goal met
        <span className="vl-swatch vl-bar" /> Below goal
        <span className="vl-swatch-line" /> Daily goal ({goal.toLocaleString()})
      </figcaption>
      <table className="vl-visually-hidden">
        <caption>Words per day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Words</th>
            <th>Goal met</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.words}</td>
              <td>{goal > 0 && d.words >= goal ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function useReadingLevel(documentIds: string[]) {
  const [result, setResult] = useState<ReturnType<typeof readability>>(null);
  const key = documentIds.join(",");
  useEffect(() => {
    let cancelled = false;
    void loadSearchIndex().then((index) => {
      const text = documentIds
        .map((id) => index.get(id)?.body ?? "")
        .filter(Boolean)
        .join("\n\n");
      if (!cancelled) setResult(readability(text));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the id list
  }, [key]);
  return result;
}

export function InsightsScreen() {
  const repo = useApp((s) => s.repo);
  const collections = useApp((s) => s.collections);
  const documents = useApp((s) => s.documents);
  const { goal, streak, loaded, load } = useWriting();
  const saved = useWriting((s) => s.saved);
  const [range, setRange] = useState<Range>("7d");
  const [sessions, setSessions] = useState<WritingSession[] | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const today = dayKey(new Date());
  const span = RANGES.find((r) => r.id === range)!.days;
  const from = addDays(today, -(span - 1));

  useEffect(() => {
    let cancelled = false;
    const start = new Date(`${addDays(from, -1)}T00:00:00`).toISOString();
    void repo.listSessions(start, new Date().toISOString()).then((s) => !cancelled && setSessions(s));
    return () => {
      cancelled = true;
    };
  }, [repo, from, saved]);

  const summary = useMemo(
    () => (sessions ? summarize(sessions, from, today, goal) : null),
    [sessions, from, today, goal],
  );
  const reading = useReadingLevel(summary?.documents.slice(0, 20).map((d) => d.documentId) ?? []);
  const maxCollection = Math.max(1, ...(summary?.byCollection.map((c) => c.words) ?? [1]));

  function exportCsv() {
    if (!summary) return;
    const blob = new Blob([insightsCsv(summary.days, goal)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vellum-insights-${from}-to-${today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <main className="vl-main">
      <div className="vl-scroll">
        <div className="vl-insights">
          <header className="vl-insights-head">
            <div>
              <h1>Insights</h1>
              <p className="vl-muted">Your writing, from sessions on this device. Only you can see this.</p>
            </div>
            <div className="vl-insights-actions">
              <div className="vl-segmented" role="radiogroup" aria-label="Range">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    role="radio"
                    aria-checked={range === r.id}
                    onClick={() => setRange(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button className="vl-btn" onClick={exportCsv} disabled={!summary}>
                <Download size={14} /> Export CSV
              </button>
            </div>
          </header>

          {summary && (
            <>
              <section className="vl-tiles" aria-label="Summary">
                <div className="vl-tile">
                  <span className="vl-tile-label">Words written</span>
                  <strong data-testid="tile-words">{summary.words.toLocaleString()}</strong>
                  <span className="vl-muted">
                    {summary.sessions} {summary.sessions === 1 ? "session" : "sessions"}
                  </span>
                </div>
                <div className="vl-tile">
                  <span className="vl-tile-label">Daily average</span>
                  <strong data-testid="tile-average">{summary.averagePerDay.toLocaleString()}</strong>
                  <span className="vl-muted">
                    Goal met on {summary.goalDays} of {summary.days.length} days
                  </span>
                </div>
                <div className="vl-tile" title={STREAK_RULE}>
                  <span className="vl-tile-label">Current streak</span>
                  <strong data-testid="tile-streak">{streak === 1 ? "1 day" : `${streak} days`}</strong>
                  <span className="vl-muted">Longest in range: {summary.longestStreak}</span>
                </div>
                <div className="vl-tile">
                  <span className="vl-tile-label">Time writing</span>
                  <strong data-testid="tile-time">{formatDuration(summary.activeMs)}</strong>
                  <span className="vl-muted">Active time, idle gaps excluded</span>
                </div>
              </section>

              <section className="vl-card" aria-labelledby="chart-h">
                <h2 id="chart-h">Words per day</h2>
                <Chart summary={summary} goal={goal} range={range} />
              </section>

              <div className="vl-insights-grid">
                <section className="vl-card" aria-labelledby="collections-h">
                  <h2 id="collections-h">By collection</h2>
                  {summary.byCollection.length === 0 ? (
                    <p className="vl-muted">Nothing written in this range yet.</p>
                  ) : (
                    <ul className="vl-breakdown" aria-label="Words by collection">
                      {summary.byCollection.map((c) => {
                        const col = collections.find((x) => x.id === c.collectionId);
                        return (
                          <li key={c.collectionId ?? "unfiled"}>
                            <span className="vl-breakdown-name">
                              <span className="vl-dot" style={{ background: col?.color ?? "var(--muted)" }} />
                              {col?.name ?? "Unfiled"}
                            </span>
                            <span className="vl-breakdown-bar">
                              <span
                                style={{
                                  width: `${(c.words / maxCollection) * 100}%`,
                                  background: col?.color,
                                }}
                              />
                            </span>
                            <span className="vl-breakdown-n">{c.words.toLocaleString()}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
                <section className="vl-card" aria-labelledby="reading-h">
                  <h2 id="reading-h">Reading level</h2>
                  {reading ? (
                    <div data-testid="reading-level">
                      <p className="vl-reading-big">{reading.label}</p>
                      <p className="vl-muted">
                        Flesch reading ease {reading.ease} · grade {reading.grade} · across{" "}
                        {summary.documents.length} {summary.documents.length === 1 ? "piece" : "pieces"} you
                        worked on
                      </p>
                      <ul className="vl-doc-list">
                        {summary.documents.slice(0, 5).map((d) => (
                          <li key={d.documentId}>
                            {displayTitle(documents.find((x) => x.id === d.documentId)?.title ?? "")}{" "}
                            <span className="vl-muted">+{d.words.toLocaleString()}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="vl-muted">Write a few more sentences to see how readable your prose is.</p>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
