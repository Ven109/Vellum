import { sync } from "@vellum/core";
import WebSocket from "ws";
import type * as Y from "yjs";

export interface TestClient {
  session: sync.SyncSession;
  ws: WebSocket;
  acks: Uint8Array[];
  close(): Promise<void>;
}

export async function connect(
  base: string,
  docId: string,
  doc: Y.Doc,
  headers: Record<string, string> = {},
): Promise<TestClient> {
  const ws = new WebSocket(`${base.replace("http", "ws")}/sync/${docId}`, { headers });
  ws.binaryType = "arraybuffer";
  const acks: Uint8Array[] = [];
  const session = new sync.SyncSession(doc, { send: (m) => ws.send(m) }, { onAck: (sv) => acks.push(sv) });
  ws.on("message", (data: ArrayBuffer) => void session.receive(new Uint8Array(data)));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  session.start();
  return {
    session,
    ws,
    acks,
    close: () =>
      new Promise<void>((resolve) => {
        session.destroy();
        ws.once("close", () => resolve());
        ws.close();
      }),
  };
}

export async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

import type { FastifyInstance } from "fastify";

/** Complete first-run setup and return the admin's session cookie and workspace id. */
export async function setupAdmin(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/setup",
    payload: {
      email: "admin@example.com",
      name: "Admin",
      password: "correct horse battery",
      workspaceName: "Main",
      ...overrides,
    },
  });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "vellum_session")!;
  const body = res.json() as { user: { id: string }; workspaces: Array<{ id: string }> };
  return {
    cookie: `vellum_session=${cookie.value}`,
    userId: body.user.id,
    workspaceId: body.workspaces[0]!.id,
  };
}

export function cookieFrom(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((x) => x.name === "vellum_session");
  return c ? `vellum_session=${c.value}` : "";
}
