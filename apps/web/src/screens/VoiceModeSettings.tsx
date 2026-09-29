import { LatencyMeter, meterValue } from "@vellum/voice";
import type { LatencySummary } from "@vellum/voice";
import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SettingsLayout } from "../components/SettingsLayout.js";
import {
  MicrophoneError,
  listMicrophones,
  openMicrophone,
  preferredMicrophone,
  setPreferredMicrophone,
} from "../voice/capture.js";
import type { MicDevice, MicSession } from "../voice/capture.js";

/** Pick a microphone and check it: level, speech detection and end-of-turn latency against the budget. */
function MicrophoneCheck() {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(preferredMicrophone());
  const [session, setSession] = useState<MicSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(-100);
  const [speaking, setSpeaking] = useState(false);
  const [turns, setTurns] = useState(0);
  const [latency, setLatency] = useState<{ last: number; summary: LatencySummary } | null>(null);
  const meter = useRef(new LatencyMeter());
  const sessionRef = useRef<MicSession | null>(null);

  const refreshDevices = () => void listMicrophones().then(setDevices);
  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
      void sessionRef.current?.stop();
    };
  }, []);

  async function start() {
    setError(null);
    try {
      const s = await openMicrophone({
        deviceId,
        onLevel: setLevel,
        onSpeechStart: () => setSpeaking(true),
        onSpeechEnd: (turn) => {
          // The reaction here is marking the turn; the voice session adds the agent's response on top.
          const ms = performance.now() - turn.stoppedAt;
          meter.current.record(ms);
          setSpeaking(false);
          setTurns((n) => n + 1);
          setLatency({ last: Math.round(ms), summary: meter.current.summary() });
        },
        onEnded: () => void stop("The microphone was disconnected."),
      });
      sessionRef.current = s;
      setSession(s);
      refreshDevices();
    } catch (e) {
      setError(e instanceof MicrophoneError ? e.message : "Couldn't start the microphone.");
    }
  }

  async function stop(reason?: string) {
    await sessionRef.current?.stop();
    sessionRef.current = null;
    setSession(null);
    setSpeaking(false);
    setLevel(-100);
    if (reason) setError(reason);
  }

  const value = Math.round(meterValue(level) * 100);
  return (
    <section className="vl-card" aria-labelledby="mic-h">
      <h2 id="mic-h">Microphone</h2>
      <p className="vl-muted">
        Voice mode listens with your browser's echo cancellation and noise suppression, and works out when
        you've finished speaking by itself. Check your microphone here.
      </p>
      <div className="vl-mic-row">
        <label className="vl-field">
          <span>Input</span>
          <select
            className="vl-input"
            aria-label="Microphone"
            value={deviceId ?? ""}
            disabled={!!session}
            onChange={(e) => {
              const id = e.target.value || undefined;
              setDeviceId(id);
              setPreferredMicrophone(id);
            }}
          >
            <option value="">System default</option>
            {devices
              .filter((d) => d.deviceId && d.deviceId !== "default")
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
          </select>
        </label>
        <button
          className={`vl-btn${session ? "" : " vl-btn-primary"}`}
          aria-pressed={!!session}
          onClick={() => void (session ? stop() : start())}
        >
          {session ? <MicOff size={14} /> : <Mic size={14} />} {session ? "Stop test" : "Test microphone"}
        </button>
      </div>
      {error && (
        <p className="vl-auth-error" role="alert">
          {error}
        </p>
      )}
      {session && (
        <div className="vl-mic-check">
          <div
            className="vl-level"
            role="meter"
            aria-label="Input level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
            data-speaking={speaking || undefined}
          >
            <span style={{ width: `${value}%` }} />
          </div>
          <p role="status" data-testid="mic-status">
            {speaking ? "Hearing you…" : `Listening on ${session.label}`}
            {turns > 0 && ` · ${turns} ${turns === 1 ? "turn" : "turns"} heard`}
          </p>
          {latency && (
            <p
              className={latency.last <= latency.summary.budgetMs ? "vl-ok" : "vl-warn"}
              data-testid="turn-latency"
            >
              Noticed you'd stopped in {latency.last} ms (budget {latency.summary.budgetMs} ms
              {latency.summary.count > 1 ? `, 95th percentile ${latency.summary.p95} ms` : ""}).
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function VoiceModeSettingsPage() {
  return (
    <SettingsLayout title="Voice mode">
      <p className="vl-lede">
        Talk through a piece and watch it being written. Set up your microphone first.
      </p>
      <MicrophoneCheck />
    </SettingsLayout>
  );
}
