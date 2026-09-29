import { useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";

/** Phones: the layout below this width is single-column with a navigation drawer. */
export const MOBILE_QUERY = "(max-width: 640px)";

/** Whether the phone layout applies right now (false where media queries aren't supported). */
export function isMobile(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(MOBILE_QUERY).matches
    : false;
}

function subscribe(fn: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobile, () => false);
}

/** The navigation drawer (the sidebar) on phones. */
export const useMobileNav = create<{ open: boolean; setOpen(open: boolean): void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/**
 * How much of the layout viewport the on-screen keyboard covers. The visual viewport shrinks when the
 * keyboard opens (and may scroll within the layout viewport), while fixed elements stay put.
 */
export function keyboardInset(layoutHeight: number, visualHeight: number, visualTop: number): number {
  const covered = layoutHeight - (visualHeight + visualTop);
  // Ignore rounding and the browser chrome sliding in and out.
  return covered > 40 ? Math.round(covered) : 0;
}

/** Keep `--kb-inset` on the root in step with the on-screen keyboard, so docked bars sit above it. */
export function useKeyboardInset(enabled: boolean) {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!enabled || !vv) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const inset = keyboardInset(window.innerHeight, vv.height, vv.offsetTop);
      root.style.setProperty("--kb-inset", `${inset}px`);
      root.toggleAttribute("data-keyboard", inset > 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      root.style.removeProperty("--kb-inset");
      root.removeAttribute("data-keyboard");
    };
  }, [enabled]);
}
