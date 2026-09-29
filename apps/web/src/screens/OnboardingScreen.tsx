import { Check, Feather } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { account } from "../data/account.js";
import { useApp } from "../state/app.js";
import { useAuth } from "../state/auth.js";
import { WRITING_KINDS, useOnboarding } from "../state/onboarding.js";
import { docPath, navigate } from "../state/router.js";
import { ImportCard } from "./ImportCard.js";
import { AddProvider } from "./ProviderSettings.js";
import { InviteForm } from "./WorkspaceSettings.js";

const STEPS = [
  { id: "name", label: "Name your workspace" },
  { id: "kinds", label: "What you write" },
  { id: "import", label: "Bring in your work" },
  { id: "ai", label: "Connect AI (optional)" },
  { id: "invite", label: "Invite people" },
] as const;

/** Done: start writing in the welcome draft, or (when skipping setup) land in the library. */
/** "Start writing" opens the welcome draft, or a new draft if it's gone; skipping goes to the library. */
async function finish(where: "write" | "library" = "write") {
  useOnboarding.getState().finish();
  if (where === "library") return navigate("/library", { replace: true });
  const { welcomeDocId, documents, createDocument } = useApp.getState();
  const welcome = welcomeDocId && documents.some((d) => d.id === welcomeDocId) ? welcomeDocId : null;
  navigate(docPath(welcome ?? (await createDocument()).id), { replace: true });
}

function StepFrame(props: {
  step: number;
  title: string;
  lede: ReactNode;
  children?: ReactNode;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  skipLabel?: string;
  form?: boolean;
}) {
  const { step, goTo } = { step: props.step, goTo: useOnboarding.getState().goTo };
  const last = step === STEPS.length - 1;
  const next = () => (props.onNext ? props.onNext() : last ? void finish() : goTo(step + 1));
  const skip = () => (last ? void finish() : goTo(step + 1));
  const actions = (
    <div className="vl-onb-actions">
      {step > 0 && (
        <button type="button" className="vl-btn" onClick={() => goTo(step - 1)}>
          Back
        </button>
      )}
      <span className="vl-toolbar-spacer" />
      <button type="button" className="vl-btn vl-btn-quiet" onClick={skip}>
        {props.skipLabel ?? "Skip this step"}
      </button>
      <button
        type={props.form ? "submit" : "button"}
        className="vl-btn vl-btn-primary"
        disabled={props.nextDisabled}
        onClick={props.form ? undefined : next}
      >
        {props.nextLabel ?? (last ? "Start writing" : "Continue")}
      </button>
    </div>
  );
  const body = (
    <>
      <p className="vl-onb-count">
        Step {step + 1} of {STEPS.length}
      </p>
      <h1 id="onb-title">{props.title}</h1>
      <p className="vl-lede">{props.lede}</p>
      {props.children}
    </>
  );
  if (props.form) {
    return (
      <form
        className="vl-onb-step"
        aria-labelledby="onb-title"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          next();
        }}
      >
        {body}
        {actions}
      </form>
    );
  }
  return (
    <section className="vl-onb-step" aria-labelledby="onb-title">
      {body}
      {actions}
    </section>
  );
}

function NameStep() {
  const workspace = useApp((s) => s.workspace);
  const me = useAuth((s) => s.me);
  const [name, setName] = useState(workspace?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <StepFrame
      step={0}
      form
      title="Name your workspace"
      lede="A workspace holds your drafts and collections. Call it after yourself, a project or a team."
      nextDisabled={!name.trim() || busy}
      onNext={() => {
        const trimmed = name.trim();
        if (!workspace || trimmed === workspace.name) return useOnboarding.getState().goTo(1);
        setBusy(true);
        setError(null);
        const onServer = me?.workspaces.some((w) => w.id === workspace.id);
        (onServer ? account.renameWorkspace(workspace.id, trimmed) : Promise.resolve())
          .then(() => useApp.getState().renameWorkspace(trimmed))
          .then(
            () => useOnboarding.getState().goTo(1),
            () => setError("Couldn't rename the workspace. You can change it later in Settings."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <label className="vl-field">
        <span>Workspace name</span>
        <input
          className="vl-input"
          value={name}
          maxLength={80}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {error && (
        <p className="vl-auth-error" role="alert">
          {error}
        </p>
      )}
    </StepFrame>
  );
}

function KindsStep() {
  const kinds = useOnboarding((s) => s.progress?.kinds ?? []);
  const collections = useApp((s) => s.collections);
  const toggle = (id: string) =>
    useOnboarding.getState().setKinds(kinds.includes(id) ? kinds.filter((k) => k !== id) : [...kinds, id]);
  return (
    <StepFrame
      step={1}
      title="What do you write?"
      lede="Pick as many as you like. Each becomes a collection so your drafts have somewhere to live."
      onNext={() => {
        void (async () => {
          const have = new Set(collections.map((c) => c.name.toLowerCase()));
          for (const k of WRITING_KINDS) {
            if (kinds.includes(k.id) && !have.has(k.label.toLowerCase()))
              await useApp.getState().createCollection(k.label);
          }
          useOnboarding.getState().goTo(2);
        })();
      }}
    >
      <div className="vl-onb-cards" role="group" aria-label="What you write">
        {WRITING_KINDS.map((k) => {
          const on = kinds.includes(k.id);
          return (
            <button
              key={k.id}
              type="button"
              className="vl-onb-card"
              aria-pressed={on}
              onClick={() => toggle(k.id)}
            >
              <span className="vl-onb-card-check" aria-hidden>
                {on && <Check size={13} />}
              </span>
              <strong>{k.label}</strong>
              <small>{k.hint}</small>
            </button>
          );
        })}
      </div>
    </StepFrame>
  );
}

function ImportStep() {
  return (
    <StepFrame
      step={2}
      title="Bring in your existing work"
      lede="Import Markdown, a Notion export or Google Docs now, or drop files on the window any time later."
    >
      <ImportCard />
    </StepFrame>
  );
}

function AiStep() {
  const [adding, setAdding] = useState(false);
  return (
    <StepFrame
      step={3}
      title="Connect an AI provider"
      lede={
        <>
          Vellum is a complete writing app without AI. Add your own key to use rewrites and the assistant: it
          stays on this device, and your provider bills you directly for what you use.
        </>
      }
      skipLabel="Skip for now"
      nextLabel="Continue"
    >
      {adding ? (
        <div className="vl-card">
          <AddProvider onDone={() => useOnboarding.getState().goTo(4)} />
        </div>
      ) : (
        <button type="button" className="vl-btn" onClick={() => setAdding(true)}>
          Add a provider key
        </button>
      )}
    </StepFrame>
  );
}

function InviteStep() {
  const workspace = useApp((s) => s.workspace);
  const me = useAuth((s) => s.me);
  const role = me?.workspaces.find((w) => w.id === workspace?.id)?.role;
  const canInvite = role === "owner" || role === "admin";
  return (
    <StepFrame
      step={4}
      title="Invite people"
      lede={
        canInvite
          ? "Write with editors, co-authors or reviewers. They'll get a link to join this workspace."
          : "Inviting people needs a Vellum server. Connect to one in Settings → Account whenever you're ready."
      }
      skipLabel="Skip"
    >
      {canInvite && workspace && <InviteForm workspaceId={workspace.id} onInvited={() => undefined} />}
    </StepFrame>
  );
}

/** Set up a new workspace in a few skippable steps; progress is kept so you can come back to it. */
export function OnboardingScreen() {
  const step = useOnboarding((s) => Math.min(s.progress?.step ?? 0, STEPS.length - 1));
  const goTo = useOnboarding((s) => s.goTo);
  return (
    <main className="vl-onb">
      <aside className="vl-onb-rail">
        <p className="vl-onb-brand">
          <Feather size={16} aria-hidden /> Vellum
        </p>
        <ol aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s.id} data-state={i < step ? "done" : i === step ? "current" : "upcoming"}>
              <button type="button" aria-current={i === step ? "step" : undefined} onClick={() => goTo(i)}>
                <span className="vl-onb-dot" aria-hidden>
                  {i < step ? <Check size={12} /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="vl-btn vl-btn-quiet vl-onb-skip"
          onClick={() => void finish("library")}
        >
          Skip setup
        </button>
      </aside>
      {step === 0 && <NameStep />}
      {step === 1 && <KindsStep />}
      {step === 2 && <ImportStep />}
      {step === 3 && <AiStep />}
      {step === 4 && <InviteStep />}
    </main>
  );
}

/** In the library while setup isn't finished: pick it up again, or dismiss it. */
export function ResumeOnboarding() {
  const pending = useOnboarding((s) => s.progress?.status === "pending");
  if (!pending) return null;
  return (
    <div className="vl-notice" role="status">
      <span>Finish setting up your workspace: a few quick steps, all optional.</span>
      <button className="vl-btn vl-btn-primary" onClick={() => navigate("/welcome")}>
        Continue setup
      </button>
      <button className="vl-btn" onClick={() => useOnboarding.getState().finish()}>
        Dismiss
      </button>
    </div>
  );
}
