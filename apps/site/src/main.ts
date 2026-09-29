import "./site.css";
import { fetchStars, formatCount } from "./github.js";

/** Fill in the GitHub star count in the nav (it simply stays hidden if GitHub can't be reached). */
async function showStars() {
  const slots = document.querySelectorAll<HTMLElement>("[data-stars]");
  if (!slots.length) return;
  const n = await fetchStars();
  if (n === null) return;
  for (const el of slots) {
    el.textContent = formatCount(n);
    el.hidden = false;
    el.closest("a")?.setAttribute("aria-label", `Vellum on GitHub, ${n.toLocaleString("en")} stars`);
  }
}

/** Small-screen navigation. */
function menu() {
  const button = document.querySelector<HTMLButtonElement>("[data-menu]");
  const nav = document.querySelector<HTMLElement>("#site-nav");
  if (!button || !nav) return;
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    nav.toggleAttribute("data-open", open);
  });
  nav.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) {
      button.setAttribute("aria-expanded", "false");
      nav.removeAttribute("data-open");
    }
  });
}

for (const el of document.querySelectorAll("[data-year]")) el.textContent = String(new Date().getFullYear());
menu();
void showStars();
