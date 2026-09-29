// Check the packaged app against the agreed budgets (budget.json): installer size, unpacked size and
// cold start (process launch to the app's first page load, median of three runs).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const budget = JSON.parse(readFileSync("budget.json", "utf8"));
const out = "release";
if (!existsSync(out)) {
  console.error("No release/ directory: run `pnpm --filter @vellum/desktop package` first.");
  process.exit(1);
}

const MB = 1024 * 1024;
function sizeOf(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((n, f) => n + sizeOf(join(path, f)), 0);
}

const failures = [];
const report = [];

for (const f of readdirSync(out)) {
  if (!/\.(dmg|exe|AppImage|deb|zip)$/.test(f)) continue;
  const mb = sizeOf(join(out, f)) / MB;
  report.push(`installer ${f}: ${mb.toFixed(1)} MB (budget ${budget.installerMB} MB)`);
  if (mb > budget.installerMB) failures.push(`${f} is ${mb.toFixed(1)} MB`);
}

const unpacked = readdirSync(out)
  .map((d) => join(out, d))
  .find((d) => statSync(d).isDirectory() && /unpacked|mac/.test(d));
let executable;
if (unpacked) {
  const mb = sizeOf(unpacked) / MB;
  report.push(`unpacked ${unpacked}: ${mb.toFixed(1)} MB (budget ${budget.unpackedMB} MB)`);
  if (mb > budget.unpackedMB) failures.push(`unpacked app is ${mb.toFixed(1)} MB`);
  if (process.platform === "darwin") executable = join(unpacked, "Vellum.app", "Contents", "MacOS", "Vellum");
  else if (process.platform === "win32") executable = join(unpacked, "Vellum.exe");
  else executable = join(unpacked, "vellum");
}

function launchOnce() {
  return new Promise((resolve, reject) => {
    const args = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
    const needsDisplay = process.platform === "linux" && !process.env.DISPLAY;
    const cmd = needsDisplay ? "xvfb-run" : executable;
    const cmdArgs = needsDisplay ? ["-a", executable, ...args] : args;
    const child = spawn(cmd, cmdArgs, { env: { ...process.env, VELLUM_MEASURE_STARTUP: "1" } });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the app didn't finish loading within 60 s"));
    }, 60_000);
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("exit", () => {
      clearTimeout(timer);
      const m = /VELLUM_STARTUP_MS=(\d+)/.exec(output);
      if (m) resolve(Number(m[1]));
      else reject(new Error(`no startup time reported:\n${output.slice(-2000)}`));
    });
  });
}

if (executable && existsSync(executable)) {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await launchOnce());
  const median = runs.sort((a, b) => a - b)[1];
  report.push(`cold start: ${median} ms median of ${runs.join(", ")} (budget ${budget.coldStartMs} ms)`);
  if (median > budget.coldStartMs) failures.push(`cold start is ${median} ms`);
} else {
  failures.push("couldn't find the packaged executable to measure cold start");
}

console.log(report.join("\n"));
if (failures.length) {
  console.error(`\nOver budget:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nWithin budget.");
