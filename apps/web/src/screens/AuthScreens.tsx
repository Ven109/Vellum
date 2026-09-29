import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ApiError, account } from "../data/account.js";
import type { WorkspaceRole } from "../data/account.js";
import { useAuth } from "../state/auth.js";
import { navigate } from "../state/router.js";

const MIN_PASSWORD = 10;

function message(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Couldn't reach the server. Check your connection and try again.";
}

/** Run an async form action with a busy flag and an error message. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function AuthShell({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <main className="vl-auth">
      <div className="vl-auth-card">
        <p className="vl-auth-brand">Vellum</p>
        <h1>{title}</h1>
        {lede && <p className="vl-lede">{lede}</p>}
        {children}
      </div>
    </main>
  );
}

function Field(props: {
  label: string;
  type?: string;
  value: string;
  onChange(v: string): void;
  autoComplete?: string;
  hint?: string;
  autoFocus?: boolean;
  minLength?: number;
}) {
  return (
    <label className="vl-auth-field">
      <span>{props.label}</span>
      <input
        className="vl-input"
        type={props.type ?? "text"}
        value={props.value}
        required
        autoFocus={props.autoFocus}
        minLength={props.minLength}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <small className="vl-muted">{props.hint}</small>}
    </label>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="vl-auth-error" role="alert">
      {error}
    </p>
  ) : null;
}

function OAuthButtons({ invite }: { invite?: string }) {
  const instance = useAuth((s) => s.instance);
  if (!instance?.oauth.length || invite) return null;
  return (
    <div className="vl-auth-oauth">
      {instance.oauth.map((p) => (
        <a key={p.id} className="vl-btn" href={account.oauthStartUrl(p.id)}>
          Continue with {p.label}
        </a>
      ))}
      <div className="vl-auth-or">
        <span>or</span>
      </div>
    </div>
  );
}

export function SetupScreen() {
  const signedIn = useAuth((s) => s.signedIn);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [signupsEnabled, setSignupsEnabled] = useState(false);
  const { busy, error, run } = useSubmit();

  return (
    <AuthShell
      title="Set up Vellum"
      lede="Create the administrator account for this server. You can invite everyone else afterwards."
    >
      <form
        className="vl-auth-form"
        onSubmit={run(async () => {
          await signedIn(await account.setup({ name, email, password, workspaceName, signupsEnabled }));
          navigate("/library", { replace: true });
        })}
      >
        <Field label="Your name" value={name} onChange={setName} autoComplete="name" autoFocus />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <label className="vl-auth-field">
          <span>Workspace name</span>
          <input
            className="vl-input"
            value={workspaceName}
            placeholder={name ? `${name}'s workspace` : "e.g. Editorial"}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        </label>
        <label className="vl-auth-check">
          <input
            type="checkbox"
            checked={signupsEnabled}
            onChange={(e) => setSignupsEnabled(e.target.checked)}
          />
          Let anyone with the address create an account
        </label>
        <p className="vl-muted vl-small-text">
          Leave this off to keep the server invite-only. You can change it later in settings.
        </p>
        <ErrorLine error={error} />
        <button className="vl-btn vl-btn-primary" disabled={busy}>
          {busy ? "Setting up…" : "Create admin account"}
        </button>
      </form>
    </AuthShell>
  );
}

const OAUTH_ERRORS: Record<string, string> = {
  oauth_state: "That sign-in link expired. Try again.",
  oauth_email: "Your account there has no verified email address.",
  signups_disabled: "There's no account for that address, and sign-up is invite-only here.",
};

export function SignInScreen() {
  const signedIn = useAuth((s) => s.signedIn);
  const instance = useAuth((s) => s.instance);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, setError, run } = useSubmit();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setError(OAUTH_ERRORS[code] ?? "Sign-in didn't complete. Try again.");
  }, [setError]);

  return (
    <AuthShell title="Sign in">
      <OAuthButtons />
      <form
        className="vl-auth-form"
        onSubmit={run(async () => {
          await signedIn(await account.login({ email, password }));
          navigate("/library", { replace: true });
        })}
      >
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <ErrorLine error={error} />
        <button className="vl-btn vl-btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="vl-auth-links">
        <a href="/forgot-password" onClick={link("/forgot-password")}>
          Forgot your password?
        </a>
        {instance?.signupsEnabled && (
          <a href="/sign-up" onClick={link("/sign-up")}>
            Create an account
          </a>
        )}
      </p>
    </AuthShell>
  );
}

function link(path: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };
}

export function SignUpScreen({ invite }: { invite?: string }) {
  const signedIn = useAuth((s) => s.signedIn);
  const instance = useAuth((s) => s.instance);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();

  if (!invite && instance && !instance.signupsEnabled) {
    return (
      <AuthShell title="Sign-up is invite-only" lede="Ask someone on this server to invite you.">
        <p className="vl-auth-links">
          <a href="/sign-in" onClick={link("/sign-in")}>
            Back to sign in
          </a>
        </p>
      </AuthShell>
    );
  }

  const form = (
    <form
      className="vl-auth-form"
      onSubmit={run(async () => {
        await signedIn(await account.signup({ name, email, password, ...(invite ? { invite } : {}) }));
        navigate("/library", { replace: true });
      })}
    >
      <Field label="Your name" value={name} onChange={setName} autoComplete="name" autoFocus />
      <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        hint={`At least ${MIN_PASSWORD} characters.`}
      />
      <ErrorLine error={error} />
      <button className="vl-btn vl-btn-primary" disabled={busy}>
        {busy ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
  if (invite) return form;
  return (
    <AuthShell title="Create your account">
      <OAuthButtons />
      {form}
      <p className="vl-auth-links">
        <a href="/sign-in" onClick={link("/sign-in")}>
          Already have an account? Sign in
        </a>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordScreen() {
  const instance = useAuth((s) => s.instance);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();
  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        lede={
          instance?.mail
            ? `If there's an account for ${email}, we've sent a link to reset its password. It works for one hour.`
            : "This server can't send email yet, so the reset link was written to the server log. Ask your administrator for it."
        }
      >
        <p className="vl-auth-links">
          <a href="/sign-in" onClick={link("/sign-in")}>
            Back to sign in
          </a>
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Reset your password" lede="We'll email you a link to choose a new one.">
      <form
        className="vl-auth-form"
        onSubmit={run(async () => {
          await account.forgot(email);
          setSent(true);
        })}
      >
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
        <ErrorLine error={error} />
        <button className="vl-btn vl-btn-primary" disabled={busy}>
          Send reset link
        </button>
      </form>
      <p className="vl-auth-links">
        <a href="/sign-in" onClick={link("/sign-in")}>
          Back to sign in
        </a>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordScreen() {
  const signedIn = useAuth((s) => s.signedIn);
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();
  return (
    <AuthShell title="Choose a new password" lede="You'll be signed out everywhere else.">
      <form
        className="vl-auth-form"
        onSubmit={run(async () => {
          await signedIn(await account.reset(token, password));
          navigate("/library", { replace: true });
        })}
      >
        <Field
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters.`}
          autoFocus
        />
        <ErrorLine error={error} />
        <button className="vl-btn vl-btn-primary" disabled={busy || !token}>
          Set password
        </button>
      </form>
    </AuthShell>
  );
}

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "an owner",
  admin: "an admin",
  member: "a member",
  guest: "a guest",
};

/** Sign in without leaving the page (the invite screen then offers to join). */
function InlineSignIn() {
  const signedIn = useAuth((s) => s.signedIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();
  return (
    <form
      className="vl-auth-form"
      onSubmit={run(async () => signedIn(await account.login({ email, password })))}
    >
      <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      <ErrorLine error={error} />
      <button className="vl-btn vl-btn-primary" disabled={busy}>
        Sign in
      </button>
    </form>
  );
}

export function InviteScreen({ token }: { token: string }) {
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.me);
  const reload = useAuth((s) => s.reload);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof account.inviteInfo>> | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    account.inviteInfo(token).then(setInfo, () => setMissing(true));
  }, [token]);

  if (missing) {
    return (
      <AuthShell
        title="This invite has expired"
        lede="Invite links work once and expire after a week. Ask for a new one."
      />
    );
  }
  if (!info)
    return (
      <div className="vl-loading" aria-busy="true">
        Loading…
      </div>
    );

  const lede = (
    <>
      {info.invitedBy} invited you to join <strong>{info.workspaceName}</strong> as {ROLE_LABEL[info.role]}.
    </>
  );

  if (status === "signed-in" && me) {
    return (
      <AuthShell title={`Join ${info.workspaceName}`} lede={lede}>
        <form
          className="vl-auth-form"
          onSubmit={run(async () => {
            const { workspaceId } = await account.acceptInvite(token);
            await reload();
            const { useApp } = await import("../state/app.js");
            await useApp.getState().switchWorkspace(workspaceId);
            navigate("/library", { replace: true });
          })}
        >
          <p className="vl-muted">Signed in as {me.user.email}.</p>
          <ErrorLine error={error} />
          <button className="vl-btn vl-btn-primary" disabled={busy}>
            Join workspace
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Join ${info.workspaceName}`} lede={lede}>
      {mode === "sign-up" ? (
        <>
          <SignUpScreen invite={token} />
          <p className="vl-auth-links">
            <button className="vl-link" onClick={() => setMode("sign-in")}>
              Already have an account? Sign in to accept
            </button>
          </p>
        </>
      ) : (
        <InlineSignIn />
      )}
    </AuthShell>
  );
}
