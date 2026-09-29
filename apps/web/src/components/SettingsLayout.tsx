import type { ReactNode } from "react";
import { navigate, usePathname } from "../state/router.js";

export const SETTINGS_SECTIONS: Array<{
  path: string;
  label: string;
  group: "Account" | "Workspace";
  desktopOnly?: boolean;
}> = [
  { path: "/settings/account", label: "Profile", group: "Account" },
  { path: "/settings/editor", label: "Editor", group: "Account" },
  { path: "/settings/shortcuts", label: "Keyboard shortcuts", group: "Account" },
  { path: "/settings/updates", label: "App updates", group: "Account", desktopOnly: true },
  { path: "/settings/workspace", label: "Workspace and people", group: "Workspace" },
  { path: "/settings/voice", label: "Voice and style", group: "Workspace" },
  { path: "/settings/ai", label: "AI provider", group: "Workspace" },
  { path: "/settings/export", label: "Export and backup", group: "Workspace" },
];

/** The settings shell: account and workspace sections on the left, the page on the right. */
export function SettingsLayout({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  const groups = ["Account", "Workspace"] as const;
  return (
    <main className="vl-main">
      <div className="vl-scroll">
        <div className="vl-settings-layout">
          <nav className="vl-settings-nav" aria-label="Settings">
            {groups.map((g) => (
              <div key={g}>
                <h2 className="vl-nav-heading">{g}</h2>
                <ul>
                  {SETTINGS_SECTIONS.filter(
                    (s) => s.group === g && (!s.desktopOnly || window.vellumDesktop),
                  ).map((s) => (
                    <li key={s.path}>
                      <a
                        href={s.path}
                        aria-current={pathname === s.path ? "page" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(s.path);
                        }}
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="vl-settings-page">
            <h1>{title}</h1>
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
