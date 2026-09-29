import type { VoiceTrait } from "@vellum/core";
import { Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  addTrait,
  deleteVoiceProfile,
  relearnVoice,
  removeTrait,
  setLearning,
  updateTrait,
  voiceMeta,
} from "../data/voice.js";
import type { VoiceMeta } from "../data/voice.js";
import { useApp } from "../state/app.js";

function TraitChip({ trait }: { trait: VoiceTrait }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trait.instruction);
  useEffect(() => setDraft(trait.instruction), [trait.instruction]);

  return (
    <li className="vl-trait" data-enabled={trait.enabled || undefined}>
      <div className="vl-trait-row">
        <label className="vl-trait-toggle">
          <input
            type="checkbox"
            checked={trait.enabled}
            aria-label={`Use “${trait.label}”`}
            onChange={(e) => void updateTrait(trait.id, { enabled: e.target.checked })}
          />
          <strong>{trait.label}</strong>
        </label>
        <button className="vl-link" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? "Close" : "Edit"}
        </button>
        <button
          className="vl-icon-btn vl-small"
          aria-label={`Remove “${trait.label}”`}
          onClick={() => void removeTrait(trait.id)}
        >
          <X size={13} />
        </button>
      </div>
      {editing ? (
        <form
          className="vl-trait-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void updateTrait(trait.id, { instruction: draft.trim() });
            setEditing(false);
          }}
        >
          <textarea
            className="vl-input"
            aria-label={`Instruction for ${trait.label}`}
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="vl-btn" type="submit" disabled={!draft.trim()}>
            Save
          </button>
        </form>
      ) : (
        <p className="vl-muted">{trait.instruction}</p>
      )}
    </li>
  );
}

export function VoiceSettings() {
  const workspace = useApp((s) => s.workspace);
  const publishedCount = useApp(
    (s) => s.documents.filter((d) => d.status === "published" && !d.isTemplate).length,
  );
  const voice = workspace?.settings.voice;
  const [meta, setMeta] = useState<VoiceMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newInstruction, setNewInstruction] = useState("");

  useEffect(() => {
    void voiceMeta().then(setMeta);
  }, [voice?.traits]);

  async function relearn() {
    setBusy(true);
    const result = await relearnVoice();
    setBusy(false);
    setMessage(
      result
        ? null
        : "Not enough published writing yet. Publish a few pieces (at least a few hundred words) and try again.",
    );
  }

  if (!voice) return null;

  return (
    <section className="vl-card" aria-labelledby="voice-heading">
      <h2 id="voice-heading">Learn my voice</h2>
      <label className="vl-switch">
        <input
          type="checkbox"
          checked={voice.learnFromPublished}
          onChange={(e) => void setLearning(e.target.checked)}
        />
        <span>
          Learn from pieces I’ve marked <strong>Published</strong>
          <small className="vl-muted">
            Drafts are never read. The profile is used to keep rewrites in your voice and stays in this
            workspace.
          </small>
        </span>
      </label>

      {voice.learnFromPublished && (
        <p className="vl-muted" data-testid="voice-source">
          {meta?.learnedAt
            ? `Learned from ${meta.pieces} published ${meta.pieces === 1 ? "piece" : "pieces"} (${meta.words.toLocaleString()} words) on ${new Date(meta.learnedAt).toLocaleDateString()}.`
            : `${publishedCount} published ${publishedCount === 1 ? "piece" : "pieces"} available to learn from.`}
        </p>
      )}

      {voice.traits.length > 0 ? (
        <ul className="vl-traits" aria-label="Voice traits">
          {voice.traits.map((t) => (
            <TraitChip key={t.id} trait={t} />
          ))}
        </ul>
      ) : (
        <p className="vl-muted">No voice traits yet.</p>
      )}

      {message && (
        <p className="vl-notice" role="status">
          {message}
        </p>
      )}

      {adding && (
        <form
          className="vl-trait-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void addTrait(newLabel.trim(), newInstruction.trim());
            setNewLabel("");
            setNewInstruction("");
            setAdding(false);
          }}
        >
          <input
            className="vl-input"
            aria-label="Trait name"
            placeholder="e.g. British spelling"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <textarea
            className="vl-input"
            aria-label="Trait instruction"
            placeholder="e.g. Use British spelling (colour, organise)."
            rows={2}
            value={newInstruction}
            onChange={(e) => setNewInstruction(e.target.value)}
          />
          <button className="vl-btn" type="submit" disabled={!newLabel.trim() || !newInstruction.trim()}>
            Add trait
          </button>
        </form>
      )}

      <div className="vl-actions">
        {voice.learnFromPublished && (
          <button className="vl-btn" disabled={busy} onClick={() => void relearn()}>
            <RefreshCw size={14} className={busy ? "vl-spin" : undefined} /> Re-learn now
          </button>
        )}
        <button className="vl-btn" onClick={() => setAdding((a) => !a)}>
          <Plus size={14} /> Add a trait
        </button>
        {voice.traits.length > 0 && (
          <button
            className="vl-btn"
            onClick={() => {
              if (
                window.confirm(
                  "Delete your voice profile? Learned traits and your edits to them will be removed.",
                )
              )
                void deleteVoiceProfile();
            }}
          >
            <Trash2 size={14} /> Delete profile
          </button>
        )}
      </div>
    </section>
  );
}

export function VoiceSettingsPage() {
  return (
    <main className="vl-main">
      <div className="vl-scroll">
        <div className="vl-settings-page">
          <h1>Voice and style</h1>
          <VoiceSettings />
        </div>
      </div>
    </main>
  );
}
