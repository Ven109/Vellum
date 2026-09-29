import { renderMarkdown } from "./markdown.js";
import { fetchReleases } from "./releases.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

async function main() {
  const slot = document.querySelector<HTMLElement>("[data-releases]")!;
  const releases = await fetchReleases();
  if (releases === null) {
    slot.innerHTML = `<p>We couldn't load the releases from GitHub. See them on <a href="https://github.com/Ven109/Vellum/releases">GitHub Releases</a>.</p>`;
    return;
  }
  if (!releases.length) {
    slot.innerHTML = `<p>No releases yet. Follow along on <a href="https://github.com/Ven109/Vellum">GitHub</a>.</p>`;
    return;
  }
  slot.innerHTML = releases
    .map((r) => {
      const id = r.tag_name.replace(/[^\w.-]/g, "");
      const date = r.published_at
        ? `<time datetime="${esc(r.published_at)}">${esc(new Date(r.published_at).toLocaleDateString("en", { dateStyle: "long" }))}</time>`
        : "";
      const notes = r.body?.trim()
        ? renderMarkdown(r.body, { idPrefix: `${id}-` })
            .replace(/<h([1-2])/g, "<h3")
            .replace(/<\/h[1-2]>/g, "</h3>")
        : '<p class="muted">No notes for this release.</p>';
      return `<article class="release" id="${esc(id)}" aria-labelledby="${esc(id)}-title">
        <header>
          <h2 id="${esc(id)}-title"><a href="#${esc(id)}">${esc(r.name || r.tag_name)}</a>${r.prerelease ? ' <span class="badge">Beta</span>' : ""}</h2>
          <p class="muted">${date} · <a href="${esc(r.html_url)}">On GitHub</a></p>
        </header>
        <div class="prose">${notes}</div>
      </article>`;
    })
    .join("");
}

void main();
