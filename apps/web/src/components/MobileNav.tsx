import { Menu } from "lucide-react";
import { useEffect } from "react";
import { useMobileNav } from "../state/mobile.js";
import { useLocation } from "../state/router.js";

/** Opens the navigation drawer on phones; hidden on wider screens. */
export function MenuButton() {
  const open = useMobileNav((s) => s.open);
  return (
    <button
      className="vl-icon-btn vl-menu-btn"
      aria-label="Open navigation"
      aria-expanded={open}
      aria-controls="vl-sidebar"
      onClick={() => useMobileNav.getState().setOpen(!open)}
    >
      <Menu size={18} />
    </button>
  );
}

/** A slim header for screens without their own top bar (library, settings, insights) on phones. */
export function MobileBar() {
  return (
    <header className="vl-mobile-bar">
      <MenuButton />
      <span className="vl-mobile-brand">Vellum</span>
    </header>
  );
}

/** Close the drawer when you go somewhere or press Escape, and dim the page behind it. */
export function NavBackdrop() {
  const open = useMobileNav((s) => s.open);
  const location = useLocation();
  useEffect(() => {
    useMobileNav.getState().setOpen(false);
  }, [location]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useMobileNav.getState().setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="vl-nav-backdrop" aria-hidden onClick={() => useMobileNav.getState().setOpen(false)} />
  );
}
