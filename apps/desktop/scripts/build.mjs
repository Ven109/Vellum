// Bundle the main process and preload, and make sure the web app is built (it ships inside the app).
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  sourcemap: true,
  external: ["electron"],
  format: "cjs",
};
await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" });
// Sandboxed preloads must be CommonJS and self-contained.
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" });

// Always rebuild the web app so the desktop app never ships a stale one (skip only when it was just built).
if (!process.env.VELLUM_SKIP_WEB_BUILD || !existsSync("../web/dist/index.html")) {
  execSync("pnpm --filter @vellum/web build", { stdio: "inherit", cwd: ".." });
}
