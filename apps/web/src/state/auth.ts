import { create } from "zustand";
import { ApiError, account } from "../data/account.js";
import type { InstanceInfo, Me } from "../data/account.js";
import { detectServer, setSessionToken, setSyncWorkspaceResolver } from "../data/server.js";
import { useApp } from "./app.js";

export type AuthStatus = "checking" | "local" | "setup" | "signed-out" | "signed-in";

interface AuthState {
  status: AuthStatus;
  instance: InstanceInfo | null;
  me: Me | null;
  /** Decide how the app runs: local-only, first-run setup, signed out, or signed in. */
  boot(): Promise<void>;
  /** Called with the server's answer after sign-in, sign-up, setup, reset or invite acceptance. */
  signedIn(me: Me): Promise<void>;
  signOut(): Promise<void>;
  /** Re-read the account (after joining or creating a workspace). */
  reload(): Promise<void>;
}

function installResolver() {
  setSyncWorkspaceResolver((docId) => {
    const { documents, workspace, account: me, shared } = useApp.getState();
    if (!me) return null;
    const sharedDoc = shared.find((d) => d.docId === docId);
    if (sharedDoc) return sharedDoc.workspaceId;
    const onServer = new Set(me.workspaces.map((w) => w.id));
    const ws = documents.find((d) => d.id === docId)?.workspaceId ?? workspace?.id;
    return ws && onServer.has(ws) ? ws : null;
  });
}

let booting: Promise<void> | null = null;

export const useAuth = create<AuthState>((set, get) => ({
  status: "checking",
  instance: null,
  me: null,

  boot() {
    booting ??= bootOnce();
    return booting;
  },

  async signedIn(me) {
    installResolver();
    set({
      me,
      status: "signed-in",
      instance: get().instance ? { ...get().instance!, setupRequired: false } : null,
    });
    await useApp.getState().init(undefined, me);
    void useApp
      .getState()
      .loadShared()
      .then(() => {
        // Keep every document on this device in step with the server, not just the open one.
        void import("../data/background-sync.js").then((m) => m.startBackgroundSync());
      });
  },

  async reload() {
    const me = await account.me();
    set({ me });
    useApp.setState({ account: me });
    await useApp.getState().syncAccount(me);
  },

  async signOut() {
    await account.logout().catch(() => undefined);
    setSessionToken(null);
    // Local copies stay on this device; a full reload drops in-memory state and live connections.
    window.location.assign("/sign-in");
  },
}));

async function bootOnce(): Promise<void> {
  if (!(await detectServer())) {
    useAuth.setState({ status: "local" });
    await useApp.getState().init(undefined, null);
    return;
  }
  let instance: InstanceInfo;
  try {
    instance = await account.instance();
  } catch {
    useAuth.setState({ status: "local" });
    await useApp.getState().init(undefined, null);
    return;
  }
  useAuth.setState({ instance });
  if (instance.setupRequired) return void useAuth.setState({ status: "setup" });
  try {
    await useAuth.getState().signedIn(await account.me());
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) useAuth.setState({ status: "signed-out" });
    else {
      // Server reachable but failing: keep writing locally rather than blocking the writer.
      useAuth.setState({ status: "local" });
      await useApp.getState().init(undefined, null);
    }
  }
}
