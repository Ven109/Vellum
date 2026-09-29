import { describe, expect, it } from "vitest";
import {
  buildsOf,
  classifyAsset,
  detectPlatform,
  formatSize,
  latestRelease,
  primaryBuild,
} from "../src/releases.js";
import type { Release, ReleaseAsset } from "../src/releases.js";

const asset = (name: string, digest?: string): ReleaseAsset => ({
  name,
  size: 120 * 1024 * 1024,
  browser_download_url: `https://github.com/Ven109/Vellum/releases/download/v1.2.0/${name}`,
  digest: digest ?? null,
});

const release = (over: Partial<Release> = {}): Release => ({
  tag_name: "v1.2.0",
  name: "Vellum 1.2.0",
  body: "",
  html_url: "https://github.com/Ven109/Vellum/releases/tag/v1.2.0",
  published_at: "2026-09-01T10:00:00Z",
  prerelease: false,
  draft: false,
  assets: [
    asset("Vellum-1.2.0-mac-arm64.dmg", "sha256:aaa"),
    asset("Vellum-1.2.0-mac-x64.dmg", "sha256:bbb"),
    asset("Vellum-1.2.0-mac-arm64.zip"),
    asset("Vellum-1.2.0-win-x64.exe", "sha256:ccc"),
    asset("Vellum-1.2.0-win-x64.exe.blockmap"),
    asset("Vellum-1.2.0-linux-x86_64.AppImage", "sha256:ddd"),
    asset("Vellum-1.2.0-linux-amd64.deb"),
    asset("Vellum-1.2.0-linux-x86_64.flatpak"),
    asset("latest-mac.yml"),
    asset("SHA256SUMS.txt"),
  ],
  ...over,
});

describe("detectPlatform", () => {
  it("reads the operating system from the user agent, then the client hint", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36";
    const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
    const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
    expect(detectPlatform(mac).platform).toBe("mac");
    expect(detectPlatform(win).platform).toBe("windows");
    expect(detectPlatform(linux).platform).toBe("linux");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux aarch64)").arm).toBe(true);
    expect(detectPlatform("Mozilla/5.0", "macOS").platform).toBe("mac");
  });

  it("offers no desktop build to phones", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)").platform).toBeNull();
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)").platform).toBeNull();
  });
});

describe("builds", () => {
  it("recognises installers, skips update metadata, and reads GitHub's digests", () => {
    expect(classifyAsset(asset("latest.yml"))).toBeNull();
    expect(classifyAsset(asset("Vellum-1.2.0-win-x64.exe.blockmap"))).toBeNull();
    expect(classifyAsset(asset("SHA256SUMS.txt"))).toBeNull();
    expect(classifyAsset(asset("Vellum-1.2.0-mac-arm64.dmg", "sha256:abc"))).toMatchObject({
      platform: "mac",
      arch: "Apple silicon",
      kind: "Disk image",
      sha256: "abc",
    });
    expect(classifyAsset(asset("Vellum-1.2.0-linux-amd64.deb"))).toMatchObject({
      platform: "linux",
      kind: "Debian/Ubuntu (.deb)",
      sha256: null,
    });
  });

  it("lists macOS, Windows then Linux, best first", () => {
    const names = buildsOf(release()).map((b) => b.asset.name);
    expect(names).toEqual([
      "Vellum-1.2.0-mac-arm64.dmg",
      "Vellum-1.2.0-mac-x64.dmg",
      "Vellum-1.2.0-mac-arm64.zip",
      "Vellum-1.2.0-win-x64.exe",
      "Vellum-1.2.0-linux-x86_64.AppImage",
      "Vellum-1.2.0-linux-amd64.deb",
      "Vellum-1.2.0-linux-x86_64.flatpak",
    ]);
  });

  it("offers the build for your platform and CPU", () => {
    const builds = buildsOf(release());
    expect(primaryBuild(builds, "mac", null)?.asset.name).toBe("Vellum-1.2.0-mac-arm64.dmg");
    expect(primaryBuild(builds, "mac", false)?.asset.name).toBe("Vellum-1.2.0-mac-x64.dmg");
    expect(primaryBuild(builds, "windows", null)?.asset.name).toBe("Vellum-1.2.0-win-x64.exe");
    expect(primaryBuild(builds, "linux", false)?.asset.name).toBe("Vellum-1.2.0-linux-x86_64.AppImage");
    expect(primaryBuild(builds, null, null)).toBeNull();
  });

  it("prefers the newest stable release", () => {
    const beta = release({ tag_name: "v1.3.0-beta.1", prerelease: true });
    expect(latestRelease([beta, release()])?.tag_name).toBe("v1.2.0");
    expect(latestRelease([beta])?.tag_name).toBe("v1.3.0-beta.1");
    expect(latestRelease([])).toBeNull();
  });

  it("formats sizes", () => {
    expect(formatSize(118 * 1024 * 1024)).toBe("118 MB");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(12)).toBe("12 B");
  });
});
