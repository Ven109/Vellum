import { useEffect } from "react";
import { flushAll, hasUnsavedWork } from "./data/ydocs.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { CoreCommands } from "./components/CoreCommands.js";
import { Sidebar } from "./components/Sidebar.js";
import { EditorScreen } from "./screens/EditorScreen.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { ProviderSettings } from "./screens/ProviderSettings.js";
import { VoiceSettingsPage } from "./screens/VoiceSettings.js";
import { useApp } from "./state/app.js";
import { navigate, useRoute } from "./state/router.js";

export function App() {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
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
    if (ready && route.name === "home") navigate("/library", { replace: true });
  }, [ready, route.name]);

  if (!ready) {
    return (
      <div className="vl-loading" aria-busy="true">
        Loading…
      </div>
    );
  }

  return (
    <div className="vl-app">
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
  if (route.name === "screen" && route.path === "/library") return <LibraryScreen />;
  if (route.name === "screen" && route.path === "/settings/ai") return <ProviderSettings />;
  if (route.name === "screen" && route.path === "/settings/voice") return <VoiceSettingsPage />;
  return (
    <main className="vl-main vl-empty">
      <p>Page not found.</p>
    </main>
  );
}
