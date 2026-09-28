import { PROVIDER_PRESETS, ProviderError, adapterFor, testConnection } from "@vellum/ai";
import type { ModelInfo, ProviderKind } from "@vellum/ai";
import { createId } from "@vellum/core";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { redact, vaultDescription } from "../data/providers.js";
import { useApp } from "../state/app.js";
import { useProviders } from "../state/providers.js";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; model: string; ms: number; reply: string }
  | { status: "error"; message: string; detail?: string };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function AddProvider({ onDone }: { onDone: () => void }) {
  const save = useProviders((s) => s.save);
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  const preset = PROVIDER_PRESETS.find((p) => p.kind === kind)!;
  const adapter = adapterFor(kind);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(adapter.defaultBaseUrl);
  const [model, setModel] = useState(preset.defaultModel);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [label, setLabel] = useState(preset.label);

  useEffect(() => {
    const p = PROVIDER_PRESETS.find((x) => x.kind === kind)!;
    setBaseUrl(adapterFor(kind).defaultBaseUrl);
    setModel(p.defaultModel);
    setLabel(p.label);
    setModels(null);
    setTest({ status: "idle" });
  }, [kind]);

  const config = useMemo(
    () => ({
      id: "draft",
      kind,
      label,
      baseUrl: baseUrl || undefined,
      apiKey: apiKey.trim() || undefined,
      defaultModel: model,
    }),
    [kind, label, baseUrl, apiKey, model],
  );
  const needsKey = adapter.requiresKey;
  const canTest = (!needsKey || apiKey.trim().length > 0) && (!preset.needsBaseUrl || baseUrl) && model;
  const destination = hostOf(baseUrl || adapter.defaultBaseUrl);

  async function loadModels() {
    try {
      const list = await adapter.listModels(config);
      setModels(list);
      if (list.length && !list.some((m) => m.id === model)) setModel(list[0]!.id);
    } catch (e) {
      const err = e as ProviderError;
      setTest({
        status: "error",
        message: err.message,
        detail: redact(err.opts?.providerMessage ?? "", [apiKey]),
      });
    }
  }

  async function runTest() {
    setTest({ status: "testing" });
    const started = performance.now();
    try {
      const res = await testConnection(adapter, config);
      setTest({
        status: "ok",
        model: res.model,
        ms: Math.round(performance.now() - started),
        reply: res.text.trim().slice(0, 40),
      });
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError("unknown", String(e));
      setTest({
        status: "error",
        message: err.message,
        detail: redact(err.opts?.providerMessage ?? "", [apiKey]),
      });
    }
  }

  async function onSave() {
    await save(
      { id: createId("key"), kind, label, baseUrl: baseUrl || undefined, defaultModel: model },
      apiKey.trim() || undefined,
    );
    setApiKey("");
    onDone();
  }

  return (
    <section className="vl-card" aria-labelledby="add-provider">
      <h2 id="add-provider">Add a provider</h2>
      <fieldset className="vl-provider-kinds">
        <legend>Provider</legend>
        {PROVIDER_PRESETS.map((p) => (
          <label key={p.kind} className="vl-kind" data-selected={p.kind === kind || undefined}>
            <input
              type="radio"
              name="kind"
              value={p.kind}
              checked={p.kind === kind}
              onChange={() => setKind(p.kind)}
            />
            <strong>{p.label}</strong>
            <span>{p.description}</span>
          </label>
        ))}
      </fieldset>

      <div className="vl-form-grid">
        <label>
          Name
          <input className="vl-input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {(preset.needsBaseUrl || kind === "openai") && (
          <label>
            Base URL
            <input
              className="vl-input"
              value={baseUrl}
              placeholder={kind === "openai-compatible" ? "http://localhost:1234/v1" : adapter.defaultBaseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setTest({ status: "idle" });
              }}
            />
          </label>
        )}
        {kind !== "ollama" && (
          <div className="vl-field">
            <label htmlFor="vl-api-key">API key {needsKey ? "" : "(optional)"}</label>
            <input
              id="vl-api-key"
              className="vl-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              placeholder={kind === "anthropic" ? "sk-ant-…" : "sk-…"}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTest({ status: "idle" });
              }}
            />
            {preset.keyUrl && (
              <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="vl-hint">
                Get a key from {preset.label}
              </a>
            )}
          </div>
        )}
        <div className="vl-field">
          <label htmlFor="vl-model">Default model</label>
          {models ? (
            <select
              id="vl-model"
              className="vl-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="vl-model"
              className="vl-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model id"
            />
          )}
          <button
            type="button"
            className="vl-link"
            disabled={!canTest && needsKey}
            onClick={() => void loadModels()}
          >
            Load available models
          </button>
        </div>
      </div>

      <p className="vl-privacy">
        <ShieldCheck size={16} aria-hidden />
        <span>
          Requests go straight from this device to <strong>{destination || "your endpoint"}</strong>. Vellum’s
          server never sees your key or your text, and there is no hosted fallback.
          {kind !== "ollama" && (
            <> Your key will be {vaultDescription().replace(/^./, (c) => c.toLowerCase())}</>
          )}
        </span>
      </p>

      <div className="vl-actions">
        <button
          className="vl-btn"
          disabled={!canTest || test.status === "testing"}
          onClick={() => void runTest()}
        >
          {test.status === "testing" ? <Loader2 size={14} className="vl-spin" /> : null} Test connection
        </button>
        <button
          className="vl-btn vl-btn-primary"
          disabled={test.status !== "ok"}
          onClick={() => void onSave()}
        >
          Save provider
        </button>
        <button className="vl-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      <div role="status" aria-live="polite" className="vl-test-result">
        {test.status === "ok" && (
          <span className="vl-ok">
            <CheckCircle2 size={16} /> Connected to {test.model} in {test.ms} ms. It replied: “{test.reply}”.
          </span>
        )}
        {test.status === "error" && (
          <span className="vl-err">
            <XCircle size={16} /> {test.message}
            {test.detail && <small> Provider said: {test.detail}</small>}
          </span>
        )}
        {test.status !== "ok" && test.status !== "testing" && (
          <small className="vl-muted"> Test the connection with a live call before saving.</small>
        )}
      </div>
    </section>
  );
}

export function ProviderSettings() {
  const { providers, keys, loaded, load, remove, save, setDefault } = useProviders();
  const workspace = useApp((s) => s.workspace);
  const [adding, setAdding] = useState(false);
  const defaultModel = workspace?.settings.defaultModel;

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    if (loaded && providers.length === 0) setAdding(true);
  }, [loaded, providers.length]);

  return (
    <main className="vl-main">
      <div className="vl-scroll">
        <div className="vl-settings-page">
          <h1>AI provider</h1>
          <p className="vl-lede">
            The writing assistant uses <strong>your own</strong> API key with the provider you choose. You pay
            the provider directly. No key, no assistant — everything else in Vellum works without one.
          </p>

          {providers.length > 0 && (
            <section className="vl-card" aria-labelledby="configured">
              <h2 id="configured">Configured providers</h2>
              <ul className="vl-provider-list">
                {providers.map((p) => {
                  const isDefault = defaultModel?.providerId === p.id;
                  const info = keys[p.id];
                  return (
                    <li key={p.id}>
                      <div>
                        <strong>{p.label}</strong>{" "}
                        {isDefault && <span className="vl-status vl-status-approved">Default</span>}
                        <div className="vl-muted">
                          Model{" "}
                          <input
                            className="vl-input vl-inline-input"
                            aria-label={`Default model for ${p.label}`}
                            defaultValue={isDefault ? defaultModel?.model : p.defaultModel}
                            onBlur={(e) => {
                              const model = e.target.value.trim();
                              if (!model) return;
                              void save({ ...p, defaultModel: model });
                              if (isDefault) void setDefault(p.id, model);
                            }}
                          />
                          {p.baseUrl && <> · {hostOf(p.baseUrl)}</>}
                        </div>
                        <div className="vl-muted">
                          <KeyRound size={12} />{" "}
                          {info ? (
                            <>
                              Key ending <code>{info.last4}</code>, saved{" "}
                              {new Date(info.savedAt).toLocaleDateString()}
                            </>
                          ) : (
                            "No key stored"
                          )}
                        </div>
                      </div>
                      <div className="vl-row-actions">
                        {!isDefault && (
                          <button className="vl-btn" onClick={() => void setDefault(p.id, p.defaultModel)}>
                            Make default
                          </button>
                        )}
                        <button
                          className="vl-btn"
                          onClick={async () => {
                            const key = window.prompt(
                              `New API key for ${p.label}. The old key is replaced on this device.`,
                            );
                            if (key?.trim()) await save(p, key.trim());
                          }}
                        >
                          Rotate key
                        </button>
                        <button
                          className="vl-btn"
                          aria-label={`Remove ${p.label}`}
                          onClick={async () => {
                            if (window.confirm(`Remove ${p.label} and delete its key from this device?`))
                              await remove(p.id);
                          }}
                        >
                          <Trash2 size={14} /> Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {adding ? (
            <AddProvider onDone={() => setAdding(providers.length === 0 && false)} />
          ) : (
            <button className="vl-btn" onClick={() => setAdding(true)}>
              Add another provider
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
