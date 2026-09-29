import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import type { Db } from "../src/db.js";
import { changedRoots } from "../src/sharing/guard.js";
import { renderDocument } from "../src/sharing/render.js";
import { connect, cookieFrom, setupAdmin, until } from "./helpers.js";

let app: FastifyInstance;
let db: Db;
let base: string;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
let bob: string;
let bobId: string;
const DOC = "doc_01sharedsharedsharedsh";

const json = (
  method: "POST" | "PATCH" | "GET" | "DELETE" | "PUT",
  url: string,
  payload?: unknown,
  cookie?: string,
) =>
  app.inject({
    method,
    url,
    ...(payload !== undefined || method !== "GET" ? { payload: (payload ?? {}) as object } : {}),
    headers: cookie ? { cookie } : {},
  });

/** Create the document on the server as the admin, with a title and a paragraph. */
async function seedDoc() {
  const doc = new Y.Doc();
  doc.getText("title").insert(0, "Field notes");
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, "Hello ");
  t.insert(6, "world", { bold: {} });
  p.insert(0, [t]);
  doc.getXmlFragment("content").insert(0, [p]);
  const c = await connect(base, `${DOC}?ws=${admin.workspaceId}`, doc, { cookie: admin.cookie });
  await until(() => c.acks.length > 0);
  await c.close();
}

beforeEach(async () => {
  db = openDatabase(":memory:");
  app = await buildApp(loadConfig({ PORT: "0", VELLUM_PUBLIC_URL: "http://vellum.test" }), {
    db,
    logger: false,
    env: {},
  });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  admin = await setupAdmin(app);
  await json("PATCH", "/api/admin/settings", { signupsEnabled: true }, admin.cookie);
  const res = await json("POST", "/api/auth/signup", {
    email: "bob@example.com",
    name: "Bob",
    password: "bob's long password",
  });
  bob = cookieFrom(res);
  bobId = res.json().user.id;
  await seedDoc();
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe("document sharing", () => {
  it("gives no access until shared, then the chosen role", async () => {
    expect((await json("GET", `/api/documents/${DOC}/access`, undefined, bob)).json()).toMatchObject({
      role: null,
    });
    expect((await json("GET", `/api/documents/${DOC}/sharing`, undefined, bob)).statusCode).toBe(403);

    const shared = await json(
      "POST",
      `/api/documents/${DOC}/shares`,
      { email: "bob@example.com", role: "comment" },
      admin.cookie,
    );
    expect(shared.json().people).toEqual([expect.objectContaining({ id: bobId, role: "comment" })]);
    expect((await json("GET", `/api/documents/${DOC}/access`, undefined, bob)).json()).toMatchObject({
      role: "comment",
    });
    expect((await json("GET", "/api/shared", undefined, bob)).json()).toEqual([
      expect.objectContaining({ docId: DOC, role: "comment", title: "Field notes", sharedBy: "Admin" }),
    ]);

    // Commenters can't manage sharing; editors can change and remove.
    expect(
      (await json("POST", `/api/documents/${DOC}/shares`, { email: "admin@example.com", role: "view" }, bob))
        .statusCode,
    ).toBe(403);
    await json("PATCH", `/api/documents/${DOC}/shares/${bobId}`, { role: "view" }, admin.cookie);
    expect((await json("GET", `/api/documents/${DOC}/access`, undefined, bob)).json().role).toBe("view");
    await json("DELETE", `/api/documents/${DOC}/shares/${bobId}`, undefined, admin.cookie);
    expect((await json("GET", `/api/documents/${DOC}/access`, undefined, bob)).json().role).toBeNull();
  });

  it("explains when the email has no account", async () => {
    const res = await json(
      "POST",
      `/api/documents/${DOC}/shares`,
      { email: "nobody@example.com", role: "view" },
      admin.cookie,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toContain("Invite them");
  });

  it("share links grant their role until they expire or are revoked", async () => {
    const bad = await json("POST", `/api/documents/${DOC}/links`, { role: "edit", days: 365 }, admin.cookie);
    expect(bad.statusCode).toBe(400);
    const res = await json("POST", `/api/documents/${DOC}/links`, { role: "suggest", days: 7 }, admin.cookie);
    const { url, link } = res.json();
    const token = url.split("/s/")[1];
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect((await json("GET", `/api/share-links/${token}`)).json()).toMatchObject({
      title: "Field notes",
      role: "suggest",
      sharedBy: "Admin",
    });
    expect((await json("POST", `/api/share-links/${token}/open`, {}, bob)).json()).toMatchObject({
      documentId: DOC,
      role: "suggest",
    });
    expect((await json("GET", `/api/documents/${DOC}/access`, undefined, bob)).json().role).toBe("suggest");

    await json("DELETE", `/api/documents/${DOC}/links/${link.id}`, undefined, admin.cookie);
    expect((await json("GET", `/api/share-links/${token}`)).statusCode).toBe(404);

    // Expired grants stop working.
    db.prepare("UPDATE doc_shares SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect((await json("GET", `/api/documents/${DOC}/access`, undefined, bob)).json().role).toBeNull();
  });

  it("publishes a read-only public page and can turn it off", async () => {
    const res = await json("PUT", `/api/documents/${DOC}/public`, { enabled: true }, admin.cookie);
    const url: string = res.json().publicUrl;
    expect(url).toMatch(/^http:\/\/vellum\.test\/p\//);
    const page = await app.inject({ method: "GET", url: new URL(url).pathname });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.body).toContain("<h1>Field notes</h1>");
    expect(page.body).toContain("<p>Hello <strong>world</strong></p>");
    await json("PUT", `/api/documents/${DOC}/public`, { enabled: false }, admin.cookie);
    expect((await app.inject({ method: "GET", url: new URL(url).pathname })).statusCode).toBe(404);
  });
});

describe("sync permissions", () => {
  it("viewers receive the document but can't change it", async () => {
    await json(
      "POST",
      `/api/documents/${DOC}/shares`,
      { email: "bob@example.com", role: "view" },
      admin.cookie,
    );
    const doc = new Y.Doc();
    const c = await connect(base, DOC, doc, { cookie: bob });
    await until(() => doc.getText("title").toString() === "Field notes");
    doc.getText("title").insert(0, "Hacked ");
    await until(() => c.ws.readyState === c.ws.CLOSED);
    const fresh = app.ctx.docs.load(DOC);
    expect(fresh.getText("title").toString()).toBe("Field notes");
  });

  it("commenters can add threads but not edit the text", async () => {
    await json(
      "POST",
      `/api/documents/${DOC}/shares`,
      { email: "bob@example.com", role: "comment" },
      admin.cookie,
    );
    const doc = new Y.Doc();
    const c = await connect(base, DOC, doc, { cookie: bob });
    await until(() => doc.getText("title").length > 0);
    doc.getMap("threads").set("thr_1", { body: "Nice" });
    await until(() => c.acks.length > 0);
    expect(c.ws.readyState).toBe(c.ws.OPEN);
    doc.getXmlFragment("content").delete(0, 1);
    await until(() => c.ws.readyState === c.ws.CLOSED);
    const stored = app.ctx.docs.load(DOC);
    expect(stored.getMap("threads").get("thr_1")).toEqual({ body: "Nice" });
    expect(stored.getXmlFragment("content").length).toBe(1);
  });

  it("finds which top-level types an update touches", () => {
    const doc = new Y.Doc();
    doc.getText("title").insert(0, "x");
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const sv = Y.encodeStateVector(other);
    other.getText("title").insert(1, "y");
    other.getMap("threads").set("a", 1);
    expect(changedRoots(doc, Y.encodeStateAsUpdate(other, sv))).toEqual(new Set(["title", "threads"]));
  });

  it("renders suggestions as the original text", () => {
    const doc = new Y.Doc();
    const p = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, "keep ");
    t.insert(5, "new", { suggestionInsert: { id: "s" } });
    t.insert(8, "old", { suggestionDelete: { id: "s" } });
    t.insert(11, " <b>", { link: { href: "javascript:alert(1)" } });
    p.insert(0, [t]);
    doc.getXmlFragment("content").insert(0, [p]);
    expect(renderDocument(doc).html).toBe("<p>keep old &lt;b&gt;</p>");
  });
});
