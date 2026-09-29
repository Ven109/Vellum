import { buildSystemPrompt } from "@vellum/ai";
import { ConversationLoop, LatencyMeter, sttPreset, ttsPreset, writerContext } from "@vellum/voice";
import type {
  Constraint,
  LatencySummary,
  Llm,
  Recognizer,
  Turn,
  TurnResult,
  WriteAction,
} from "@vellum/voice";
import { create } from "zustand";
import { openRecognizer, ttsConfig, useSpeech } from "../data/speech.js";
import { assistantContext } from "../state/assistant.js";
import { useApp } from "../state/app.js";
import { useDocSession } from "../state/session.js";
import { acquireDoc, releaseDoc } from "../data/ydocs.js";
import type { LiveDoc } from "../data/ydocs.js";
import { loadConversation, observeConversation, saveConversation } from "../data/transcript.js";
import { MicrophoneError, openMicrophone, preferredMicrophone } from "./capture.js";
import type { MicSession } from "./capture.js";
import { voiceModel } from "./llm.js";
import { Speaker } from "./speaker.js";
import { DocWriter } from "./writer.js";

export type VoiceStatus = "idle" | "starting" | "listening" | "hearing" | "thinking" | "error";

export interface PendingInstruction {
  turnId: string;
  text: string;
  actions: WriteAction[];
}

export interface VoiceStack {
  microphone: string;
  recognition: string;
  model: string | null;
  voice: string;
}

interface VoiceSessionState {
  docId: string | null;
  /** The turn a clicked paragraph came from (highlighted in the transcript). */
  focusedTurn: string | null;
  /** Load a document's transcript (the screen shows it before and after a session). */
  open(docId: string): Promise<void>;
  close(): void;
  focusTurn(turnId: string | null): void;
  status: VoiceStatus;
  error: string | null;
  muted: boolean;
  level: number;
  interim: string;
  turns: Turn[];
  constraints: Constraint[];
  agentWriting: boolean;
  writingPaused: boolean;
  agentSpeaking: boolean;
  pending: PendingInstruction | null;
  queued: number;
  latency: LatencySummary | null;
  stack: VoiceStack | null;
  start(docId: string): Promise<void>;
  end(): Promise<void>;
  setMuted(muted: boolean): void;
  pauseWriting(): void;
  resumeWriting(): void;
  takeOver(): void;
  applyNow(): void;
  queueIt(): void;
  ignore(): void;
  editConstraint(id: string, label: string): void;
  removeConstraint(id: string): void;
}

const VOICE_WRITER = `You are co-writing this piece with the writer, who is talking to you while you write.
Draft in their voice. Keep their points, and use their specific words and examples where you can.
Follow every constraint they set. Don't pad; write what the piece needs next.`;

/** Everything that lives only while a session runs. */
let mic: MicSession | null = null;
let recognizer: Recognizer | null = null;
let loop: ConversationLoop | null = null;
let writer: DocWriter | null = null;
let speaker: Speaker | null = null;
let model: { llm: Llm; label: string; model: string } | null = null;
let meter = new LatencyMeter();
let queue: WriteAction[][] = [];
let doc: { id: string; live: LiveDoc; unobserve: () => void } | null = null;
let opening = 0;
let working = false;

export const useVoiceSession = create<VoiceSessionState>((set, get) => {
  function syncLoop() {
    if (!loop) return;
    set({ turns: loop.state.turns, constraints: loop.state.constraints });
    // Kept with the document, so the brief and the conversation can be picked up later.
    if (doc) saveConversation(doc.live.doc, loop.state);
  }

  function say(text: string) {
    loop?.agentSaid(text);
    syncLoop();
    // Spoken replies never block writing; talking over them stops them.
    void speaker?.speak(text).catch(() => undefined);
  }

  async function drain() {
    if (working) return;
    working = true;
    try {
      while (queue.length && !get().writingPaused && writer) {
        const actions = queue.shift()!;
        set({ queued: queue.length });
        for (const a of actions) {
          const note = await writer.run(a);
          if (note) say(note);
          if (get().writingPaused || !writer) break;
        }
      }
    } finally {
      working = false;
    }
  }

  async function onTurn(text: string) {
    if (!loop) return;
    const result: TurnResult = await loop.handleTurn(text);
    syncLoop();
    const { actions, reply } = result.plan;
    if (reply) say(reply);
    if (get().agentWriting) {
      if (!actions.length) {
        // Just talk (or thinking aloud): carry on writing.
        writer?.release();
        return;
      }
      // A new instruction mid-write: by default it's applied once the current sentence is finished, so
      // a thought is never left half-written. The card offers Apply now, Queue it or Ignore meanwhile.
      set({ pending: { turnId: result.turnId, text, actions } });
      writer?.finishSentence();
      return;
    }
    if (!actions.length) return;
    queue.push(actions);
    void drain();
  }

  return {
    docId: null,
    focusedTurn: null,
    status: "idle",
    error: null,
    muted: false,
    level: -100,
    interim: "",
    turns: [],
    constraints: [],
    agentWriting: false,
    writingPaused: false,
    agentSpeaking: false,
    pending: null,
    queued: 0,
    latency: null,
    stack: null,

    async open(docId) {
      if (doc?.id === docId) return;
      get().close();
      const mine = ++opening;
      const live = acquireDoc(docId);
      await live.whenLoaded;
      if (mine !== opening) {
        // Closed or reopened while loading.
        releaseDoc(docId);
        return;
      }
      const refresh = () => {
        // Another device (or tab) added to the transcript while no session runs here.
        if (get().status !== "idle" && get().status !== "error") return;
        const state = loadConversation(live.doc);
        set({ turns: state.turns, constraints: state.constraints });
      };
      doc = { id: docId, live, unobserve: observeConversation(live.doc, refresh) };
      set({ docId });
      refresh();
    },

    close() {
      opening++;
      if (!doc) return;
      doc.unobserve();
      releaseDoc(doc.id);
      doc = null;
      loop = null;
      set({ docId: null, turns: [], constraints: [], focusedTurn: null });
    },

    focusTurn(turnId) {
      set({ focusedTurn: turnId });
    },

    async start(docId) {
      if (get().status !== "idle" && get().status !== "error") return;
      await get().open(docId);
      set({ docId, status: "starting", error: null, pending: null, latency: null });
      meter = new LatencyMeter();
      queue = [];
      try {
        recognizer = await openRecognizer({
          onInterim: (t) => set({ interim: t }),
          onError: (e) => set({ error: e.message }),
        });
        if (!recognizer) {
          set({
            status: "error",
            error: "Choose a speech recognition provider in Settings → Voice mode first.",
          });
          return;
        }
        model = await voiceModel().catch(() => null);
        // Pick up where the last session on this document left off: brief, constraints and turns.
        loop = new ConversationLoop(
          model ? { llm: model.llm } : {},
          doc ? loadConversation(doc.live.doc) : undefined,
        );
        speaker = new Speaker(await ttsConfig());
        speaker.onState = (s) => set({ agentSpeaking: s !== "idle" });
        writer = new DocWriter({
          editor: () => useDocSession.getState().editor,
          llm: () => model?.llm ?? null,
          system: () =>
            [
              buildSystemPrompt(assistantContext("document")).system,
              VOICE_WRITER,
              loop ? writerContext(loop.state) : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          onWriting: (w) => set({ agentWriting: w }),
          attribution: () => {
            const user = useApp.getState().user;
            const docId = get().docId;
            if (!user || !docId) return null;
            return {
              docId,
              userId: user.id,
              providerId: model?.label ?? "none",
              model: model?.model ?? "voice (no model)",
            };
          },
        });
        writer.onSentenceDone = () => {
          // The sentence finished: the waiting instruction goes next.
          const p = get().pending;
          if (!p) return;
          queue.unshift(p.actions);
          set({ pending: null, queued: queue.length });
          void drain();
        };
        mic = await openMicrophone({
          deviceId: preferredMicrophone(),
          onLevel: (level) => set({ level }),
          onFrame: (pcm, speaking) => recognizer?.push(pcm, speaking),
          onSpeechStart: () => {
            // Barge-in: the agent stops talking at once, and writing pauses at the end of the word.
            speaker?.stop();
            writer?.hold();
            set({ status: "hearing" });
          },
          onSpeechEnd: (turn) => {
            // React first (the budget), then transcribe.
            set({ status: "thinking" });
            meter.record(performance.now() - turn.stoppedAt);
            set({ latency: meter.summary() });
            const r = recognizer;
            if (!r) return;
            void r.endTurn().then(
              async (text) => {
                set({ interim: "" });
                if (text) await onTurn(text);
                else writer?.release();
                if (get().status === "thinking") set({ status: "listening" });
              },
              () => {
                writer?.release();
                set({ status: "listening" });
              },
            );
          },
          onEnded: () => {
            set({ error: "The microphone was disconnected." });
            void get().end();
          },
        });
        const s = useSpeech.getState().settings;
        set({
          status: "listening",
          stack: {
            microphone: mic.label,
            recognition: sttPreset(s.stt!.kind).label,
            model: model ? `${model.label} · ${model.model}` : null,
            voice: ttsPreset(s.tts.kind).label,
          },
        });
      } catch (e) {
        await get().end();
        set({ status: "error", error: e instanceof MicrophoneError ? e.message : (e as Error).message });
      }
    },

    async end() {
      writer?.stop();
      speaker?.stop();
      recognizer?.close();
      await mic?.stop();
      mic = recognizer = writer = speaker = null;
      queue = [];
      set({
        status: "idle",
        level: -100,
        interim: "",
        agentWriting: false,
        agentSpeaking: false,
        pending: null,
        queued: 0,
      });
    },

    setMuted(muted) {
      mic?.setMuted(muted);
      if (muted) recognizer?.cancelTurn();
      set({ muted, ...(muted ? { status: "listening" as const, interim: "" } : {}) });
    },

    pauseWriting() {
      writer?.stop();
      set({ writingPaused: true });
    },

    resumeWriting() {
      set({ writingPaused: false });
      void drain();
    },

    takeOver() {
      // Stop writing and hand the cursor back; the session keeps listening.
      writer?.stop();
      speaker?.stop();
      set({ writingPaused: true });
      useDocSession.getState().editor?.commands.focus("end");
    },

    applyNow() {
      const p = get().pending;
      if (!p) return;
      set({ pending: null });
      queue.unshift(p.actions);
      // Stop straight away, but not mid-word.
      writer?.stopAtNextWord();
      void drain();
    },

    queueIt() {
      const p = get().pending;
      if (!p) return;
      set({ pending: null });
      queue.push(p.actions);
      set({ queued: queue.length });
      // Let the current piece of writing finish as planned.
      writer?.release();
      void drain();
    },

    ignore() {
      set({ pending: null });
      writer?.release();
    },

    editConstraint(id, label) {
      loop?.updateConstraint(id, { label, value: label });
      syncLoop();
    },

    removeConstraint(id) {
      loop?.removeConstraint(id);
      syncLoop();
    },
  };
});
