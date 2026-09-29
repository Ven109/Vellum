import { SettingsLayout } from "../components/SettingsLayout.js";
import { MOD_KEY } from "../state/commands.js";

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "Anywhere",
    items: [
      [`${MOD_KEY}K`, "Command palette: search documents and run commands"],
      [`${MOD_KEY}J`, "Open or close the assistant"],
      [`${MOD_KEY}⇧F`, "Focus mode (in a document)"],
      ["Esc", "Close a dialog, discard a proposal, leave focus mode"],
    ],
  },
  {
    title: "Writing",
    items: [
      [`${MOD_KEY}B`, "Bold"],
      [`${MOD_KEY}I`, "Italic"],
      [`${MOD_KEY}U`, "Underline"],
      [`${MOD_KEY}⇧S`, "Strikethrough"],
      [`${MOD_KEY}E`, "Inline code"],
      [`${MOD_KEY}Z`, "Undo"],
      [`${MOD_KEY}⇧Z`, "Redo"],
      ["Enter (in the title)", "Move to the body"],
    ],
  },
  {
    title: "Markdown as you type",
    items: [
      ["# ␣ … ###### ␣", "Heading 1–6"],
      ["> ␣", "Quote"],
      ["- ␣ or * ␣", "Bulleted list"],
      ["1. ␣", "Numbered list"],
      ["```", "Code block"],
      ["---", "Divider"],
      ["**text**, *text*, `text`", "Bold, italic, code"],
    ],
  },
  {
    title: "Rewrites",
    items: [
      [`${MOD_KEY}Enter`, "Accept the proposed rewrite"],
      ["Esc", "Discard it"],
    ],
  },
];

export function ShortcutSettingsPage() {
  return (
    <SettingsLayout title="Keyboard shortcuts">
      {GROUPS.map((g) => (
        <section key={g.title} className="vl-card" aria-label={g.title}>
          <h2>{g.title}</h2>
          <dl className="vl-shortcuts">
            {g.items.map(([keys, what]) => (
              <div key={keys + what}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </SettingsLayout>
  );
}
