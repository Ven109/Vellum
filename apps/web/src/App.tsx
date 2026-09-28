import { useEffect } from "react";
import { flushAll, hasUnsavedWork } from "./data/ydocs.js";
import { Sidebar } from "./components/Sidebar.js";
import { EditorScreen } from "./screens/EditorScreen.js";
import { useApp } from "./state/app.js";
import { docPath, navigate, useRoute } from "./state/router.js";

export function App() {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const documents = useApp((s) => s.documents);
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
    if (ready && route.name === "home" && documents[0]) navigate(docPath(documents[0].id), { replace: true });
  }, [ready, route.name, documents]);

  if (!ready) {
    return (
      <div className="vl-loading" aria-busy="true">
        Loading…
      </div>
    );
  }

  return (
    <div className="vl-app">
      <Sidebar />
      {route.name === "doc" ? (
        <EditorScreen key={route.id} docId={route.id} />
      ) : (
        <main className="vl-main vl-empty">
          <p>Create a draft to get started.</p>
        </main>
      )}
    </div>
  );
}
