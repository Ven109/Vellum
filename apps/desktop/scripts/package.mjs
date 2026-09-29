// Package the app with electron-builder. Pull requests build unsigned installers for the current OS;
// releases (--release) sign, notarise and publish, and include Flatpak on Linux.
import { execFileSync } from "node:child_process";

const release = process.argv.includes("--release");
const args = ["electron-builder", "--publish", release ? "always" : "never"];
if (process.platform === "linux")
  args.push("--linux", ...(release ? ["AppImage", "deb", "flatpak"] : ["AppImage", "deb"]));
if (process.platform === "darwin") {
  args.push("--mac");
  if (release) args.push("-c.mac.notarize=true");
}
if (process.platform === "win32") args.push("--win");
execFileSync("pnpm", ["exec", ...args], { stdio: "inherit", shell: process.platform === "win32" });
