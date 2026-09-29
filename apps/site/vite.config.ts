import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { generatePages } from "./src/pages.js";

const root = fileURLToPath(new URL(".", import.meta.url));

// Docs, download and changelog pages are generated from the repository before each build or dev run.
const generated = process.env.VITEST ? [] : generatePages(root, resolve(root, "../.."));

/** vellum.app: a static, multi-page site (no framework, a little TypeScript). */
export default defineConfig({
  appType: "mpa",
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: Object.fromEntries([
        ["index", resolve(root, "index.html")],
        ...generated.map((f) => [f.replace(/\/index\.html$/, "").replace(/\W+/g, "-"), resolve(root, f)]),
      ]),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
