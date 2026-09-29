import {
  LatencyMeter,
  PREVIEW_TEXT,
  STT_PRESETS,
  TTS_PRESETS,
  meterValue,
  sttPreset,
  ttsPreset,
} from "@vellum/voice";
import type { LatencySummary, Recognizer, SttKind, TtsKind, VoiceOption } from "@vellum/voice";
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
import {
  openRecognizer,
  removeSpeechKey,
  saveSpeechKey,
  speechKeyInfo,
  sttKeyId,
  ttsConfig,
  ttsKeyId,
  useSpeech,
} from "../data/speech.js";
import type { KeyInfo } from "../data/keys.js";
import { Speaker } from "../voice/speaker.js";

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
  const recognizer = useRef<Recognizer | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [interim, setInterim] = useState("");

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
    setHeard(null);
    try {
      recognizer.current = await openRecognizer({
        onInterim: setInterim,
        onError: (e) => setError(e.message),
      });
      const s = await openMicrophone({
        deviceId,
        onLevel: setLevel,
        onFrame: (pcm, speaking) => recognizer.current?.push(pcm, speaking),
        onSpeechStart: () => setSpeaking(true),
        onSpeechEnd: (turn) => {
          const r = recognizer.current;
          if (r)
            void r.endTurn().then(
              (text) => {
                setHeard(text || "(nothing recognised)");
                setInterim("");
              },
              () => undefined,
            );
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
    recognizer.current?.close();
    recognizer.current = null;
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
          {interim && (
            <p className="vl-muted" data-testid="interim">
              {interim}
            </p>
          )}
          {heard !== null && (
            <p data-testid="heard">
              <strong>Heard:</strong> {heard}
            </p>
          )}
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

/** Save (or replace, or remove) one provider's key in the key vault. */
function KeyField({
  id,
  label,
  keyUrl,
  onChange,
}: {
  id: string;
  label: string;
  keyUrl?: string;
  onChange?: () => void;
}) {
  const [info, setInfo] = useState<KeyInfo | undefined>();
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    void speechKeyInfo(id).then((i) => {
      setInfo(i);
      setEditing(!i);
    });
  }, [id]);
  if (info && !editing)
    return (
      <p className="vl-key-saved">
        {label} key ••••{info.last4}{" "}
        <button className="vl-btn" onClick={() => setEditing(true)}>
          Replace
        </button>{" "}
        <button
          className="vl-btn"
          onClick={() =>
            void removeSpeechKey(id).then(() => {
              setInfo(undefined);
              setEditing(true);
              onChange?.();
            })
          }
        >
          Remove
        </button>
      </p>
    );
  return (
    <form
      className="vl-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim())
          void saveSpeechKey(id, value).then((i) => {
            setInfo(i);
            setValue("");
            setEditing(false);
            onChange?.();
          });
      }}
    >
      <input
        className="vl-input"
        type="password"
        autoComplete="off"
        aria-label={`${label} API key`}
        placeholder="API key"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="vl-btn vl-btn-primary" disabled={!value.trim()}>
        Save key
      </button>
      {keyUrl && (
        <a href={keyUrl} target="_blank" rel="noreferrer" className="vl-muted">
          Get a key
        </a>
      )}
    </form>
  );
}

function SpeechToTextCard() {
  const stt = useSpeech((s) => s.settings.stt);
  const update = useSpeech((s) => s.update);
  const preset = stt ? sttPreset(stt.kind) : null;
  return (
    <section className="vl-card" aria-labelledby="stt-h">
      <h2 id="stt-h">Speech recognition</h2>
      <p className="vl-muted">
        Turns what you say into text. Use your own key with a provider, or run whisper.cpp on your own machine
        so audio never leaves it.
      </p>
      <div className="vl-provider-choices" role="radiogroup" aria-label="Speech recognition provider">
        {[null, ...STT_PRESETS].map((p) => (
          <label
            key={p?.kind ?? "off"}
            className="vl-kind"
            data-selected={(stt?.kind ?? null) === (p?.kind ?? null) || undefined}
          >
            <input
              type="radio"
              name="stt"
              checked={(stt?.kind ?? null) === (p?.kind ?? null)}
              onChange={() => update({ stt: p ? { kind: p.kind as SttKind } : null })}
            />
            <strong>{p?.label ?? "Off"}</strong>
            {p?.local && <span className="vl-badge">Local</span>}
            <small className="vl-muted">{p?.description ?? "Voice mode stays off until you pick one."}</small>
          </label>
        ))}
      </div>
      {preset && stt && (
        <div className="vl-provider-fields">
          {preset.needsKey && (
            <KeyField id={sttKeyId(stt.kind)} label={preset.label} keyUrl={preset.keyUrl} />
          )}
          {preset.needsBaseUrl && (
            <label className="vl-field">
              <span>Server address</span>
              <input
                className="vl-input"
                value={stt.baseUrl ?? preset.defaultBaseUrl}
                onChange={(e) => update({ stt: { ...stt, baseUrl: e.target.value } })}
              />
              <small className="vl-muted">
                Start it with <code>whisper-server -m models/ggml-base.en.bin --port 8080</code>.
              </small>
            </label>
          )}
          <label className="vl-field">
            <span>Language (optional)</span>
            <input
              className="vl-input"
              placeholder="Detect automatically, or e.g. en"
              value={stt.language ?? ""}
              onChange={(e) => update({ stt: { ...stt, language: e.target.value.trim() || undefined } })}
            />
          </label>
        </div>
      )}
    </section>
  );
}

function VoiceCard() {
  const tts = useSpeech((s) => s.settings.tts);
  const update = useSpeech((s) => s.update);
  const preset = ttsPreset(tts.kind);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const speaker = useRef<Speaker | null>(null);

  const refresh = () => {
    setVoices(null);
    setLoadError(null);
    void ttsConfig()
      .then((c) => new Speaker(c).listVoices())
      .then(setVoices, (e: Error) => setLoadError(e.message));
  };
  useEffect(refresh, [tts.kind]);
  useEffect(() => () => speaker.current?.stop(), []);

  async function preview() {
    speaker.current?.stop();
    const s = new Speaker(await ttsConfig());
    speaker.current = s;
    s.onState = (st) =>
      setStatus(st === "loading" ? "Getting the voice ready…" : st === "speaking" ? "Playing preview…" : "");
    const chosen = voices?.find((v) => v.id === (tts.voice ?? preset.defaultVoice));
    await s.speak(PREVIEW_TEXT, chosen?.previewUrl).catch((e: Error) => setStatus(e.message));
  }

  return (
    <section className="vl-card" aria-labelledby="tts-h">
      <h2 id="tts-h">Voice</h2>
      <p className="vl-muted">How the agent talks back. The system voice works with no setup.</p>
      <div className="vl-provider-choices" role="radiogroup" aria-label="Voice provider">
        {TTS_PRESETS.map((p) => (
          <label key={p.kind} className="vl-kind" data-selected={tts.kind === p.kind || undefined}>
            <input
              type="radio"
              name="tts"
              checked={tts.kind === p.kind}
              onChange={() => update({ tts: { kind: p.kind as TtsKind } })}
            />
            <strong>{p.label}</strong>
            {p.local && <span className="vl-badge">On this device</span>}
            <small className="vl-muted">{p.description}</small>
          </label>
        ))}
      </div>
      <div className="vl-provider-fields">
        {preset.needsKey && (
          <KeyField id={ttsKeyId(tts.kind)} label={preset.label} keyUrl={preset.keyUrl} onChange={refresh} />
        )}
        <div className="vl-inline-form">
          <select
            className="vl-input"
            aria-label="Voice"
            value={tts.voice ?? preset.defaultVoice}
            disabled={!voices?.length}
            onChange={(e) => update({ tts: { ...tts, voice: e.target.value } })}
          >
            {!voices?.length && <option value="">{voices ? "Default voice" : "Loading voices…"}</option>}
            {voices?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.description ? ` — ${v.description}` : ""}
              </option>
            ))}
          </select>
          <button className="vl-btn" onClick={() => void preview()}>
            Preview
          </button>
          {preset.needsKey && (
            <button className="vl-btn" onClick={refresh}>
              Refresh voices
            </button>
          )}
        </div>
        {loadError && <p className="vl-muted">{loadError}</p>}
        <p className="vl-muted" role="status" data-testid="voice-status">
          {status}
        </p>
      </div>
    </section>
  );
}

export function VoiceModeSettingsPage() {
  return (
    <SettingsLayout title="Voice mode">
      <p className="vl-lede">
        Talk through a piece and watch it being written. Set up your microphone first.
      </p>
      <SpeechToTextCard />
      <VoiceCard />
      <MicrophoneCheck />
    </SettingsLayout>
  );
}
