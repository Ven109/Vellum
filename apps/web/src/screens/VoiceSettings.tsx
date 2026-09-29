import { SettingsLayout } from "../components/SettingsLayout.js";
import { relativeTime } from "@vellum/core";
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
import { setLeaveGuard } from "../state/router.js";

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

/** "Last edited by …" for the workspace's writing settings. */
function LastEdited() {
  const settings = useApp((s) => s.workspace?.settings);
  const user = useApp((s) => s.user);
  const members = useApp((s) => s.members);
  if (!settings?.updatedAt) return null;
  const who =
    settings.updatedBy === user?.id
      ? "you"
      : (members.find((m) => m.id === settings.updatedBy)?.name ?? "someone in this workspace");
  return (
    <p className="vl-muted vl-last-edited" data-testid="last-edited">
      Last edited by {who}, {relativeTime(settings.updatedAt)}.
    </p>
  );
}

function HouseRules() {
  const saved = useApp((s) => s.workspace?.settings.houseRules ?? "");
  const updateWorkspaceSettings = useApp((s) => s.updateWorkspaceSettings);
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;
  useEffect(() => setDraft(saved), [saved]);

  // Ask before leaving with unsaved rules (in-app navigation, back button, closing the tab).
  useEffect(() => {
    if (!dirty) return;
    setLeaveGuard(() => "You have unsaved house rules. Leave without saving?");
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);

  const rules = draft.split("\n").filter((l) => l.trim()).length;
  return (
    <section className="vl-card" aria-labelledby="rules-heading">
      <h2 id="rules-heading">House rules</h2>
      <p className="vl-muted">
        Plain-language rules for everything the assistant writes in this workspace — one per line. They’re
        added to every assistant request.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void updateWorkspaceSettings({ houseRules: draft.trim() });
        }}
      >
        <textarea
          className="vl-input vl-rules"
          aria-label="House rules"
          rows={8}
          placeholder={"Use British spelling.\nNo exclamation marks.\nSay “people”, not “users”."}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="vl-actions">
          <button className="vl-btn vl-btn-primary" disabled={!dirty}>
            Save rules
          </button>
          {dirty && (
            <button type="button" className="vl-btn" onClick={() => setDraft(saved)}>
              Discard changes
            </button>
          )}
          <span className="vl-muted" role="status">
            {dirty ? "Unsaved changes" : `${rules} ${rules === 1 ? "rule" : "rules"}`}
          </span>
        </div>
      </form>
    </section>
  );
}

const BEHAVIOURS = [
  {
    key: "inlineSuggestions",
    label: "Show rewrites inline",
    hint: "Proposed rewrites appear as a diff in the text. When off, they’re shown only in the proposal card.",
  },
  {
    key: "flagRepeatedPhrasing",
    label: "Flag repeated phrasing",
    hint: "Underline three-word phrases you’ve used more than once in the same piece.",
  },
  {
    key: "showAssistantActivity",
    label: "Show assistant activity",
    hint: "Show how many assistant edits a piece has, next to its history. They’re always kept in history.",
  },
] as const;

function Behaviour() {
  const behaviour = useApp((s) => s.workspace?.settings.behaviour);
  const updateWorkspaceSettings = useApp((s) => s.updateWorkspaceSettings);
  if (!behaviour) return null;
  return (
    <section className="vl-card" aria-labelledby="behaviour-heading">
      <h2 id="behaviour-heading">Assistant behaviour</h2>
      {BEHAVIOURS.map((b) => (
        <label key={b.key} className="vl-switch">
          <input
            type="checkbox"
            checked={behaviour[b.key]}
            onChange={(e) =>
              void updateWorkspaceSettings({ behaviour: { ...behaviour, [b.key]: e.target.checked } })
            }
          />
          <span>
            {b.label}
            <small className="vl-muted">{b.hint}</small>
          </span>
        </label>
      ))}
    </section>
  );
}

export function VoiceSettingsPage() {
  return (
    <SettingsLayout title="Voice and style">
      <LastEdited />
      <VoiceSettings />
      <HouseRules />
      <Behaviour />
    </SettingsLayout>
  );
}
