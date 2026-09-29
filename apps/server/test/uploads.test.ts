import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import type { Db } from "../src/db.js";
import { DiskStore, S3Store, createBlobStore } from "../src/storage.js";
import { sniffImage } from "../src/uploads.js";
import { setupAdmin } from "./helpers.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
let app: FastifyInstance;
let db: Db;
let dir: string;

beforeEach(async () => {
  db = openDatabase(":memory:");
  dir = mkdtempSync(join(tmpdir(), "vellum-uploads-"));
  app = await buildApp(loadConfig({ PORT: "0" }), { db, logger: false, env: {}, blobs: new DiskStore(dir) });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const upload = (
  body: Buffer,
  cookie?: string,
  headers: Record<string, string> = { "x-vellum-upload": "1" },
) =>
  app.inject({
    method: "POST",
    url: "/api/uploads",
    payload: body,
    headers: { "content-type": "image/png", ...headers, ...(cookie ? { cookie } : {}) },
  });

describe("uploads", () => {
  it("stores an image and serves it back with safe headers", async () => {
    const { cookie } = await setupAdmin(app);
    const res = await upload(PNG, cookie);
    expect(res.statusCode).toBe(200);
    const { url } = res.json();
    expect(url).toMatch(/^\/files\/[a-z0-9]+\.png$/);
    const file = await app.inject({ method: "GET", url });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["cache-control"]).toContain("immutable");
    expect(Buffer.compare(file.rawPayload, PNG)).toBe(0);
    expect((await app.inject({ method: "GET", url: "/files/nope.png" })).statusCode).toBe(404);
  });

  it("requires sign-in, the upload header, and a real image", async () => {
    expect((await upload(PNG)).statusCode).toBe(401);
    const { cookie } = await setupAdmin(app);
    expect((await upload(PNG, cookie, {})).statusCode).toBe(415);
    const svg = await upload(Buffer.from("<svg onload=alert(1)>"), cookie);
    expect(svg.statusCode).toBe(415);
    expect(svg.json().message).toContain("PNG, JPEG");
  });

  it("recognises images by their bytes", () => {
    expect(sniffImage(PNG)?.type).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffImage(Buffer.from("GIF89a"))?.type).toBe("image/gif");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))?.type).toBe("image/webp");
    expect(sniffImage(Buffer.from("<svg/>"))).toBeNull();
  });
});

describe("object storage", () => {
  it("signs S3 requests with AWS Signature Version 4", () => {
    const s3 = new S3Store({
      endpoint: "http://s3.test:9000",
      bucket: "vellum",
      accessKey: "AKID",
      secretKey: "secret",
    });
    const { url, headers } = s3.sign(
      "PUT",
      "/vellum/a.png",
      new Uint8Array([1]),
      new Date("2026-01-02T03:04:05Z"),
    );
    expect(url).toBe("http://s3.test:9000/vellum/a.png");
    expect(headers["x-amz-date"]).toBe("20260102T030405Z");
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/20260102\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("uses S3 when configured and insists on credentials", () => {
    expect(createBlobStore({}, "/tmp/x").kind).toBe("disk");
    expect(() => createBlobStore({ VELLUM_S3_ENDPOINT: "http://s3" }, "/tmp/x")).toThrow(/VELLUM_S3_BUCKET/);
    expect(
      createBlobStore(
        {
          VELLUM_S3_ENDPOINT: "http://s3",
          VELLUM_S3_BUCKET: "b",
          VELLUM_S3_ACCESS_KEY: "k",
          VELLUM_S3_SECRET_KEY: "s",
        },
        "/tmp/x",
      ).kind,
    ).toBe("s3");
  });

  // Runs against a real S3-compatible server when one is provided (the Docker smoke test does).
  it.runIf(process.env.VELLUM_TEST_S3_ENDPOINT)("round-trips through a real S3 server", async () => {
    const s3 = new S3Store({
      endpoint: process.env.VELLUM_TEST_S3_ENDPOINT!,
      bucket: "vellum-test",
      accessKey: process.env.VELLUM_TEST_S3_ACCESS_KEY!,
      secretKey: process.env.VELLUM_TEST_S3_SECRET_KEY!,
    });
    await s3.init();
    await s3.init();
    await s3.put("t1.png", PNG, "image/png");
    expect(Buffer.compare(Buffer.from((await s3.get("t1.png"))!), PNG)).toBe(0);
    expect(await s3.get("missing.png")).toBeNull();
  });
});
