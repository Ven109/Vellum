import { useEffect } from "react";
import { toggleFocus } from "../components/CoreCommands.js";
import { useImportDrop } from "../components/ImportDrop.js";
import { useApp } from "../state/app.js";
import { useCommands } from "../state/commands.js";
import { docPath, navigate, useLocation } from "../state/router.js";

export const desktop = () => (typeof window !== "undefined" ? window.vellumDesktop : undefined);

/** Wire the desktop app's menus, deep links and "open with" files into the web app. */
export function useDesktopIntegration(ready: boolean) {
  const location = useLocation();

  // Tell the main process which document this window shows (one document per window).
  useEffect(() => {
    desktop()?.setCurrentPath?.(location);
  }, [location]);

  useEffect(() => {
    const d = desktop();
    if (!d || !ready) return;
    const offCommand = d.onCommand?.((c) => {
      if (c.type === "navigate") navigate(c.path);
      else if (c.type === "toggle-focus") toggleFocus();
      else if (c.type === "palette") useCommands.getState().openPalette();
      else if (c.type === "new-draft")
        void useApp
          .getState()
          .createDocument()
          .then((doc) => navigate(docPath(doc.id)));
    });
    const offFiles = d.onImportFiles?.((files) => void useImportDrop.getState().start(files));
    return () => {
      offCommand?.();
      offFiles?.();
    };
  }, [ready]);
}
