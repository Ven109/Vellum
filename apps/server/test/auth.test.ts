import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import type { Db } from "../src/db.js";
import { connect, cookieFrom, setupAdmin, until } from "./helpers.js";

let app: FastifyInstance;
let db: Db;
let base: string;
const sent: Array<{ to: string; text: string }> = [];

beforeEach(async () => {
  db = openDatabase(":memory:");
  sent.length = 0;
  app = await buildApp(loadConfig({ PORT: "0", VELLUM_PUBLIC_URL: "http://vellum.test" }), {
    db,
    logger: false,
    env: {},
  });
  // Capture "emails" (SMTP not configured → logged); intercept via the log isn't convenient, so read tokens from the DB-backed flow.
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const json = (method: "POST" | "PATCH" | "GET" | "DELETE", url: string, payload?: unknown, cookie?: string) =>
  app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    headers: cookie ? { cookie } : {},
  });

describe("first-run setup and sessions", () => {
  it("requires setup, then only once", async () => {
    expect((await json("GET", "/api/instance")).json()).toMatchObject({
      setupRequired: true,
      signupsEnabled: true,
      voice: { localOnly: false },
    });
    const admin = await setupAdmin(app);
    expect((await json("GET", "/api/instance")).json()).toMatchObject({
      setupRequired: false,
      signupsEnabled: false,
    });
    const me = (await json("GET", "/api/auth/me", undefined, admin.cookie)).json();
    expect(me.user).toMatchObject({ email: "admin@example.com", isAdmin: true });
    expect(me.user.password_hash).toBeUndefined();
    expect(me.workspaces).toEqual([{ id: admin.workspaceId, name: "Main", role: "owner" }]);
    expect(
      (await json("POST", "/api/setup", { email: "x@example.com", name: "X", password: "0123456789" }))
        .statusCode,
    ).toBe(409);
  });

  it("logs in and out, rejects bad passwords without revealing which part was wrong", async () => {
    await setupAdmin(app);
    const bad = await json("POST", "/api/auth/login", {
      email: "admin@example.com",
      password: "wrong password!",
    });
    expect(bad.statusCode).toBe(401);
    const unknown = await json("POST", "/api/auth/login", {
      email: "nobody@example.com",
      password: "wrong password!",
    });
    expect(unknown.json().message).toBe(bad.json().message);
    const ok = await json("POST", "/api/auth/login", {
      email: "ADMIN@example.com",
      password: "correct horse battery",
    });
    const cookie = cookieFrom(ok);
    expect((await json("GET", "/api/auth/me", undefined, cookie)).statusCode).toBe(200);
    await json("POST", "/api/auth/logout", {}, cookie);
    expect((await json("GET", "/api/auth/me", undefined, cookie)).statusCode).toBe(401);
  });

  it("rejects non-JSON state-changing requests (CSRF guard)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: "email=a&password=b",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.statusCode).toBe(415);
  });

  it("rate-limits repeated login attempts", async () => {
    await setupAdmin(app);
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (
        await json("POST", "/api/auth/login", { email: "admin@example.com", password: "nope nope nope" })
      ).statusCode;
    expect(last).toBe(429);
  });
});

describe("sign-up policy and invites", () => {
  it("blocks public sign-up when disabled but allows invited people", async () => {
    const admin = await setupAdmin(app);
    const blocked = await json("POST", "/api/auth/signup", {
      email: "a@example.com",
      name: "Ann",
      password: "a long password",
    });
    expect(blocked.statusCode).toBe(403);

    const inv = (
      await json(
        "POST",
        `/api/workspaces/${admin.workspaceId}/invites`,
        { email: "ann@example.com", role: "member" },
        admin.cookie,
      )
    ).json();
    const token = inv.link.split("/invite/")[1];
    expect((await json("GET", `/api/invites/${token}`)).json()).toMatchObject({
      workspaceName: "Main",
      invitedBy: "Admin",
      role: "member",
    });
    const signup = await json("POST", "/api/auth/signup", {
      email: "ann@example.com",
      name: "Ann",
      password: "a long password",
      invite: token,
    });
    expect(signup.statusCode).toBe(200);
    expect(signup.json().workspaces).toEqual([{ id: admin.workspaceId, name: "Main", role: "member" }]);
    // Invites are single-use.
    expect((await json("GET", `/api/invites/${token}`)).statusCode).toBe(404);
  });

  it("lets an admin re-enable public sign-up", async () => {
    const admin = await setupAdmin(app);
    await json("PATCH", "/api/admin/settings", { signupsEnabled: true }, admin.cookie);
    const res = await json("POST", "/api/auth/signup", {
      email: "bo@example.com",
      name: "Bo",
      password: "another long one",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workspaces[0]).toMatchObject({ name: "Bo's workspace", role: "owner" });
    const bo = cookieFrom(res);
    expect((await json("PATCH", "/api/admin/settings", { signupsEnabled: false }, bo)).statusCode).toBe(403);
  });

  it("manages members and keeps at least one owner", async () => {
    const admin = await setupAdmin(app);
    const list = (
      await json("GET", `/api/workspaces/${admin.workspaceId}/members`, undefined, admin.cookie)
    ).json();
    expect(list.members).toHaveLength(1);
    const res = await json(
      "PATCH",
      `/api/workspaces/${admin.workspaceId}/members/${admin.userId}`,
      { role: "member" },
      admin.cookie,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("password reset", () => {
  it("resets with a one-time token and signs out other sessions", async () => {
    const admin = await setupAdmin(app);
    const reset = app.ctx.accounts.createPasswordReset("admin@example.com")!;
    const weak = await json("POST", "/api/auth/password/reset", { token: reset.token, password: "short" });
    expect(weak.statusCode).toBe(400);
    const ok = await json("POST", "/api/auth/password/reset", {
      token: reset.token,
      password: "a brand new password",
    });
    expect(ok.statusCode).toBe(200);
    expect((await json("GET", "/api/auth/me", undefined, admin.cookie)).statusCode).toBe(401);
    expect(
      (await json("POST", "/api/auth/password/reset", { token: reset.token, password: "again and again" }))
        .statusCode,
    ).toBe(400);
    expect((await json("POST", "/api/auth/password/forgot", { email: "nobody@example.com" })).json()).toEqual(
      { ok: true },
    );
  });
});

describe("OAuth", () => {
  it("signs in with GitHub, linking by verified email", async () => {
    await app.close();
    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("access_token")) return Response.json({ access_token: "gh-token" });
      if (u.endsWith("/user"))
        return Response.json({ id: 42, login: "admin", name: "Admin", email: "public@example.com" });
      return Response.json([
        { email: "unverified@example.com", primary: false, verified: false },
        { email: "admin@example.com", primary: true, verified: true },
      ]);
    }) as typeof fetch;
    app = await buildApp(loadConfig({ PORT: "0", VELLUM_PUBLIC_URL: "http://vellum.test" }), {
      db,
      logger: false,
      env: { VELLUM_OAUTH_GITHUB_ID: "id", VELLUM_OAUTH_GITHUB_SECRET: "secret" },
      fetchImpl: fakeFetch,
    });
    await setupAdmin(app);
    expect((await json("GET", "/api/instance")).json().oauth).toEqual([{ id: "github", label: "GitHub" }]);
    const start = await json("GET", "/api/auth/oauth/github/start");
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const stateCookie = start.cookies.find((c) => c.name === "vellum_oauth_state")!;
    const cb = await app.inject({
      method: "GET",
      url: `/api/auth/oauth/github/callback?code=abc&state=${state}`,
      headers: { cookie: `vellum_oauth_state=${stateCookie.value}` },
    });
    expect(cb.headers.location).toBe("http://vellum.test/");
    const me = (await json("GET", "/api/auth/me", undefined, cookieFrom(cb))).json();
    expect(me.user.email).toBe("admin@example.com");

    const forged = await app.inject({
      method: "GET",
      url: `/api/auth/oauth/github/callback?code=abc&state=other`,
      headers: { cookie: `vellum_oauth_state=${stateCookie.value}` },
    });
    expect(forged.headers.location).toContain("error=oauth_state");
  });
});

describe("sync access control", () => {
  it("requires a session and workspace membership", async () => {
    const admin = await setupAdmin(app);
    const doc = new Y.Doc();
    const anon = await connect(base, `doc_01zzzzzzzzzzzzzzzzzzzz?ws=${admin.workspaceId}`, doc).catch(
      (e: Error) => e,
    );
    if (!(anon instanceof Error)) await until(() => anon.ws.readyState === anon.ws.CLOSED);

    await json("PATCH", "/api/admin/settings", { signupsEnabled: true }, admin.cookie);
    const other = cookieFrom(
      await json("POST", "/api/auth/signup", {
        email: "eve@example.com",
        name: "Eve",
        password: "eve's long password",
      }),
    );
    const mine = await connect(base, `doc_01zzzzzzzzzzzzzzzzzzzz?ws=${admin.workspaceId}`, new Y.Doc(), {
      cookie: admin.cookie,
    });
    await until(() => mine.session.isSynced);
    const eve = await connect(base, `doc_01zzzzzzzzzzzzzzzzzzzz?ws=${admin.workspaceId}`, new Y.Doc(), {
      cookie: other,
    });
    await until(() => eve.ws.readyState === eve.ws.CLOSED);
    expect(app.ctx.accounts.documentWorkspace("doc_01zzzzzzzzzzzzzzzzzzzz")).toBe(admin.workspaceId);
    await mine.close();
  });
});

describe("voice policy", () => {
  it("self-hosters can require local-only voice", async () => {
    await app.close();
    app = await buildApp(loadConfig({ PORT: "0", VELLUM_PUBLIC_URL: "http://vellum.test" }), {
      db: openDatabase(":memory:"),
      logger: false,
      env: { VELLUM_VOICE_LOCAL_ONLY: "true" },
    });
    expect((await json("GET", "/api/instance")).json().voice).toEqual({ localOnly: true });
  });
});
