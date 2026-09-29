import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Where uploaded files (images) are kept: S3-compatible object storage, or the data directory. */
export interface BlobStore {
  readonly kind: "s3" | "disk";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Make sure the store is usable (creates the bucket if it doesn't exist). */
  init(): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export class DiskStore implements BlobStore {
  readonly kind = "disk" as const;
  constructor(private readonly dir: string) {}

  async init() {
    // The directory is created on first upload.
  }

  async put(key: string, data: Uint8Array) {
    if (!SAFE_KEY.test(key)) throw new Error("invalid key");
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, key), data);
  }

  async get(key: string) {
    if (!SAFE_KEY.test(key)) return null;
    try {
      return new Uint8Array(await readFile(join(this.dir, key)));
    } catch {
      return null;
    }
  }
}

export interface S3Options {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  fetchImpl?: typeof fetch;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/**
 * Minimal S3 client (path-style, AWS Signature Version 4) for any S3-compatible server — AWS S3,
 * SeaweedFS, Garage, RustFS, Cloudflare R2 and so on. Only what uploads need: create bucket, put, get.
 */
export class S3Store implements BlobStore {
  readonly kind = "s3" as const;
  private readonly region: string;
  private readonly f: typeof fetch;

  constructor(private readonly opts: S3Options) {
    this.region = opts.region ?? "us-east-1";
    this.f = opts.fetchImpl ?? fetch;
  }

  /** Signed request; exported for tests through `sign`. */
  sign(method: string, path: string, body: Uint8Array | undefined, now = new Date()) {
    const url = new URL(this.opts.endpoint.replace(/\/+$/, "") + path);
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(body ?? "");
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    const signed = Object.keys(headers).sort();
    const canonical = [
      method,
      url.pathname,
      "",
      signed.map((h) => `${h}:${headers[h]}\n`).join(""),
      signed.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
    const key = hmac(hmac(hmac(hmac(`AWS4${this.opts.secretKey}`, date), this.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", key).update(toSign).digest("hex");
    return {
      url: url.toString(),
      headers: {
        ...(headers as { host: string; "x-amz-content-sha256": string; "x-amz-date": string }),
        authorization: `AWS4-HMAC-SHA256 Credential=${this.opts.accessKey}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`,
      },
    };
  }

  private async request(method: string, path: string, body?: Uint8Array, contentType?: string) {
    const { url, headers } = this.sign(method, path, body);
    // fetch sets Host itself (it's a forbidden header), from the same URL we signed.
    const { host: _host, ...sendHeaders } = headers;
    return this.f(url, {
      method,
      headers: { ...sendHeaders, ...(contentType ? { "content-type": contentType } : {}) },
      ...(body ? { body: Buffer.from(body) } : {}),
    });
  }

  private objectPath(key: string) {
    if (!SAFE_KEY.test(key)) throw new Error("invalid key");
    return `/${encodeURIComponent(this.opts.bucket)}/${key}`;
  }

  async init() {
    const res = await this.request("PUT", `/${encodeURIComponent(this.opts.bucket)}`);
    // 409 means the bucket is already there.
    if (!res.ok && res.status !== 409) {
      throw new Error(
        `object storage: can't create bucket ${this.opts.bucket} (HTTP ${res.status}): ${await res.text()}`,
      );
    }
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    const res = await this.request("PUT", this.objectPath(key), data, contentType);
    if (!res.ok) throw new Error(`object storage: upload failed (HTTP ${res.status})`);
  }

  async get(key: string) {
    if (!SAFE_KEY.test(key)) return null;
    const res = await this.request("GET", this.objectPath(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`object storage: read failed (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export function createBlobStore(
  env: NodeJS.ProcessEnv,
  dataDir: string,
  fetchImpl?: typeof fetch,
): BlobStore {
  if (env.VELLUM_S3_ENDPOINT) {
    const need = ["VELLUM_S3_BUCKET", "VELLUM_S3_ACCESS_KEY", "VELLUM_S3_SECRET_KEY"].filter((k) => !env[k]);
    if (need.length) throw new Error(`VELLUM_S3_ENDPOINT is set but ${need.join(", ")} missing`);
    return new S3Store({
      endpoint: env.VELLUM_S3_ENDPOINT,
      bucket: env.VELLUM_S3_BUCKET!,
      accessKey: env.VELLUM_S3_ACCESS_KEY!,
      secretKey: env.VELLUM_S3_SECRET_KEY!,
      ...(env.VELLUM_S3_REGION ? { region: env.VELLUM_S3_REGION } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }
  return new DiskStore(join(dataDir, "uploads"));
}
