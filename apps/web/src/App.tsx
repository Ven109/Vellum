import { useEffect } from "react";
import { flushAll, hasUnsavedWork } from "./data/ydocs.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { CoreCommands } from "./components/CoreCommands.js";
import { Sidebar } from "./components/Sidebar.js";
import { EditorScreen } from "./screens/EditorScreen.js";
import { HistoryScreen } from "./screens/HistoryScreen.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { ProviderSettings } from "./screens/ProviderSettings.js";
import { VoiceSettingsPage } from "./screens/VoiceSettings.js";
import {
  ForgotPasswordScreen,
  InviteScreen,
  ResetPasswordScreen,
  SetupScreen,
  ShareLinkScreen,
  SignInScreen,
  SignUpScreen,
} from "./screens/AuthScreens.js";
import { WorkspaceSettingsPage } from "./screens/WorkspaceSettings.js";
import { useApp } from "./state/app.js";
import { useAuth } from "./state/auth.js";
import { useFocus } from "./state/focus.js";
import { navigate, useRoute } from "./state/router.js";

const AUTH_PATHS = ["/setup", "/sign-in", "/sign-up", "/forgot-password", "/reset-password"];

export function App() {
  const status = useAuth((s) => s.status);
  const boot = useAuth((s) => s.boot);
  const route = useRoute();

  useEffect(() => {
    void boot();
  }, [boot]);

  const path = route.name === "screen" ? route.path : "";
  const invite = /^\/invite\/([^/]+)$/.exec(path)?.[1];

  if (status === "checking") return <Loading />;
  if (status === "setup") return <SetupScreen />;
  if (invite) return <InviteScreen token={decodeURIComponent(invite)} />;
  const shareLink = /^\/s\/([^/]+)$/.exec(path)?.[1];
  if (shareLink && status !== "local") return <ShareLinkScreen token={decodeURIComponent(shareLink)} />;
  if (status === "signed-out") {
    if (path === "/sign-up") return <SignUpScreen />;
    if (path === "/forgot-password") return <ForgotPasswordScreen />;
    if (path === "/reset-password") return <ResetPasswordScreen />;
    return <SignInScreen />;
  }
  if (path === "/reset-password") return <ResetPasswordScreen />;
  return <Workspace leaveAuthPath={AUTH_PATHS.includes(path)} />;
}

function Loading() {
  return (
    <div className="vl-loading" aria-busy="true">
      Loading…
    </div>
  );
}

function Workspace({ leaveAuthPath }: { leaveAuthPath: boolean }) {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const focus = useFocus((s) => s.active);
  const route = useRoute();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      flushAll();
      if (hasUnsavedWork()) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    if (ready && (route.name === "home" || leaveAuthPath)) navigate("/library", { replace: true });
  }, [ready, route.name, leaveAuthPath]);

  if (!ready) return <Loading />;

  return (
    <div className="vl-app" data-focus={(focus && route.name === "doc") || undefined}>
      <CoreCommands />
      <Sidebar />
      <Screen />
      <CommandPalette />
    </div>
  );
}

function Screen() {
  const route = useRoute();
  if (route.name === "doc") return <EditorScreen key={route.id} docId={route.id} splitId={route.split} />;
  if (route.name === "history") return <HistoryScreen key={route.id} docId={route.id} />;
  if (route.name === "screen" && route.path === "/library") return <LibraryScreen />;
  if (route.name === "screen" && route.path === "/settings/ai") return <ProviderSettings />;
  if (route.name === "screen" && route.path === "/settings/voice") return <VoiceSettingsPage />;
  if (route.name === "screen" && route.path === "/settings/workspace") return <WorkspaceSettingsPage />;
  return (
    <main className="vl-main vl-empty">
      <p>Page not found.</p>
    </main>
  );
}
