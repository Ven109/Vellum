import { measureVoice, mergeTraits, traitsFromStats } from "@vellum/core";
import type { VoiceTrait } from "@vellum/core";
import * as Y from "yjs";
import { useApp } from "../state/app.js";
import { LocalDocPersistence } from "./local-persistence.js";

/** Block texts of a document's CRDT content, one entry per paragraph/heading/list item. */
export function fragmentBlocks(fragment: Y.XmlFragment): string[] {
  const out: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement) {
        if (
          ["paragraph", "heading", "listItem", "blockquote"].includes(child.nodeName) &&
          child.nodeName !== "blockquote"
        ) {
          const text = child
            .toArray()
            .map((c) =>
              c instanceof Y.XmlText
                ? (c.toDelta() as Array<{ insert: unknown }>)
                    .map((d) => (typeof d.insert === "string" ? d.insert : ""))
                    .join("")
                : "",
            )
            .join("");
          if (child.nodeName === "heading") continue; // headings aren't prose rhythm
          if (text.trim()) out.push(text);
          if (child.nodeName === "listItem") walk(child);
        } else walk(child);
      }
    }
  };
  walk(fragment);
  return out;
}

async function publishedTexts(): Promise<Array<{ id: string; text: string }>> {
  const docs = useApp.getState().documents.filter((d) => d.status === "published" && !d.isTemplate);
  const out: Array<{ id: string; text: string }> = [];
  for (const d of docs) {
    const ydoc = new Y.Doc();
    const p = new LocalDocPersistence(d.id, ydoc);
    await p.whenLoaded;
    out.push({ id: d.id, text: fragmentBlocks(ydoc.getXmlFragment("content")).join("\n\n") });
    p.destroy();
    ydoc.destroy();
  }
  return out;
}

export interface VoiceMeta {
  learnedAt?: string;
  pieces: number;
  words: number;
  edited: string[];
  deleted: string[];
}

const META_KEY = "voice.meta";

export async function voiceMeta(): Promise<VoiceMeta> {
  return (
    (await useApp.getState().repo.getSetting<VoiceMeta>(META_KEY)) ?? {
      pieces: 0,
      words: 0,
      edited: [],
      deleted: [],
    }
  );
}

async function saveMeta(meta: VoiceMeta) {
  await useApp.getState().repo.putSetting(META_KEY, meta);
}

/**
 * Re-learn the voice profile from published documents only. Drafts, in review and archived pieces
 * are never read. Returns null when there isn't enough published writing yet.
 */
export async function relearnVoice(): Promise<{ traits: VoiceTrait[]; meta: VoiceMeta } | null> {
  const { workspace, updateWorkspaceSettings } = useApp.getState();
  if (!workspace?.settings.voice.learnFromPublished) return null;
  const pieces = await publishedTexts();
  const stats = measureVoice(pieces.map((p) => p.text));
  const meta = await voiceMeta();
  if (!stats) return null;
  const traits = mergeTraits(
    traitsFromStats(stats),
    workspace.settings.voice.traits,
    new Set(meta.edited),
    new Set(meta.deleted),
  );
  const nextMeta: VoiceMeta = {
    ...meta,
    learnedAt: new Date().toISOString(),
    pieces: pieces.length,
    words: stats.words,
  };
  await updateWorkspaceSettings({ voice: { ...workspace.settings.voice, traits } });
  await saveMeta(nextMeta);
  return { traits, meta: nextMeta };
}

export async function updateTrait(id: string, patch: Partial<VoiceTrait>): Promise<void> {
  const { workspace, updateWorkspaceSettings } = useApp.getState();
  if (!workspace) return;
  const traits = workspace.settings.voice.traits.map((t) => (t.id === id ? { ...t, ...patch } : t));
  await updateWorkspaceSettings({ voice: { ...workspace.settings.voice, traits } });
  if (patch.instruction !== undefined || patch.label !== undefined) {
    const meta = await voiceMeta();
    if (!meta.edited.includes(id)) await saveMeta({ ...meta, edited: [...meta.edited, id] });
  }
}

export async function removeTrait(id: string): Promise<void> {
  const { workspace, updateWorkspaceSettings } = useApp.getState();
  if (!workspace) return;
  await updateWorkspaceSettings({
    voice: {
      ...workspace.settings.voice,
      traits: workspace.settings.voice.traits.filter((t) => t.id !== id),
    },
  });
  const meta = await voiceMeta();
  if (!id.startsWith("custom-") && !meta.deleted.includes(id))
    await saveMeta({ ...meta, deleted: [...meta.deleted, id] });
}

export async function addTrait(label: string, instruction: string): Promise<void> {
  const { workspace, updateWorkspaceSettings } = useApp.getState();
  if (!workspace) return;
  const trait: VoiceTrait = { id: `custom-${Date.now().toString(36)}`, label, instruction, enabled: true };
  await updateWorkspaceSettings({
    voice: { ...workspace.settings.voice, traits: [...workspace.settings.voice.traits, trait] },
  });
}

/** Delete the whole profile: learned traits, edits and history. Learning stays in whatever state it was. */
export async function deleteVoiceProfile(): Promise<void> {
  const { workspace, updateWorkspaceSettings } = useApp.getState();
  if (!workspace) return;
  await updateWorkspaceSettings({ voice: { ...workspace.settings.voice, traits: [] } });
  await saveMeta({ pieces: 0, words: 0, edited: [], deleted: [] });
}

export async function setLearning(on: boolean): Promise<void> {
  const { workspace, updateWorkspaceSettings } = useApp.getState();
  if (!workspace) return;
  await updateWorkspaceSettings({ voice: { ...workspace.settings.voice, learnFromPublished: on } });
  if (on) await relearnVoice();
}
