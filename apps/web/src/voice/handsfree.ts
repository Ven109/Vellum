/**
 * Hands-free sessions: keep the screen awake while you talk, put session controls on the lock screen and
 * in the notification shade (Media Session), and tell the session when the screen goes off and on.
 */
export interface HandsFreeOptions {
  title: string;
  onMute: () => void;
  onUnmute: () => void;
  onEnd: () => void;
  onScreen: (on: boolean) => void;
}

type WakeLockSentinelLike = {
  release(): Promise<void>;
  addEventListener?(t: "release", f: () => void): void;
};

export function startHandsFree(o: HandsFreeOptions): () => void {
  let lock: WakeLockSentinelLike | null = null;
  let stopped = false;
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
  };

  const acquire = async () => {
    if (stopped || document.visibilityState !== "visible" || !nav.wakeLock) return;
    try {
      lock = await nav.wakeLock.request("screen");
    } catch {
      lock = null; // Low battery, or not allowed: the session still works, the screen may just dim.
    }
  };

  // The browser drops the wake lock when the page is hidden; take it again when it's back.
  const onVisibility = () => {
    const on = document.visibilityState === "visible";
    o.onScreen(on);
    if (on) void acquire();
  };
  document.addEventListener("visibilitychange", onVisibility);
  void acquire();

  const ms = "mediaSession" in navigator ? navigator.mediaSession : null;
  if (ms) {
    try {
      ms.metadata = new MediaMetadata({ title: "Voice session", artist: o.title, album: "Vellum" });
      ms.setActionHandler("pause", () => o.onMute());
      ms.setActionHandler("play", () => o.onUnmute());
      ms.setActionHandler("stop", () => o.onEnd());
      ms.playbackState = "playing";
    } catch {
      /* partial support */
    }
  }

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibility);
    void lock?.release().catch(() => undefined);
    lock = null;
    if (ms) {
      for (const action of ["pause", "play", "stop"] as const) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
      ms.metadata = null;
      ms.playbackState = "none";
    }
  };
}
