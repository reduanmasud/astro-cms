import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { openDatabase, type Db } from "./db/database.ts";
import { createRateLimiter } from "./lib/rate-limiter.ts";
import { createCollaboratorService } from "./services/collaborators.ts";
import { createHealthService } from "./services/health.ts";
import { createSessionService } from "./services/sessions.ts";

const PASSWORD = "correct-horse-battery";
const SECRET = "test-session-secret-that-is-long-enough";

interface Body {
  ok?: boolean;
  collaborator?: { id: string; name: string } | null;
  error?: { code: string; message: string };
}

function buildApp(
  options: { db?: Db; loginLimit?: number; secret?: string } = {},
) {
  const db = options.db ?? openDatabase(":memory:");
  const collaborators = createCollaboratorService({ db });
  return createApp({
    health: createHealthService({ db }),
    sessions: createSessionService({ db, password: PASSWORD, collaborators }),
    loginLimiter: createRateLimiter({
      limit: options.loginLimit ?? 100,
      windowMs: 60_000,
    }),
    sessionSecret: options.secret ?? SECRET,
    cookieSecure: false,
  });
}

type App = ReturnType<typeof buildApp>;

async function readBody(response: Response): Promise<Body> {
  return (await response.json()) as Body;
}

function login(app: App, body: unknown, contentType = "application/json") {
  return app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("Set-Cookie") ?? "";
  const pair = header.split(";")[0] ?? "";
  if (!pair.startsWith("cms_session="))
    throw new Error(`No session cookie in: ${header}`);
  return pair;
}

async function signIn(app: App, name?: string): Promise<string> {
  const cookie = sessionCookie(await login(app, { password: PASSWORD }));
  if (name !== undefined) await chooseName(app, cookie, name);
  return cookie;
}

function chooseName(app: App, cookie: string, name: unknown) {
  return app.request("/api/session/display-name", {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

function currentSession(app: App, cookie?: string) {
  return app.request("/api/session", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("GET /api/health", () => {
  it("responds with { ok: true } without authentication", async () => {
    const response = await buildApp().request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("responds 503 with { ok: false } when the database is unavailable", async () => {
    const db = openDatabase(":memory:");
    const app = buildApp({ db });
    db.close();

    const response = await app.request("/api/health");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
  });
});

describe("login", () => {
  it("rejects an invalid password with 401 and sets no cookie", async () => {
    const response = await login(buildApp(), {
      password: "wrong-password-123",
    });

    expect(response.status).toBe(401);
    expect((await readBody(response)).error?.code).toBe("invalid_password");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("accepts a valid password and sets a signed, HttpOnly session cookie", async () => {
    const response = await login(buildApp(), { password: PASSWORD });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ collaborator: null });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^cms_session=[A-Za-z0-9_-]{43}\.[^;]+;/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it("never sends CMS_PASSWORD or SESSION_SECRET to the browser", async () => {
    const response = await login(buildApp(), { password: PASSWORD });

    const everything = `${JSON.stringify([...response.headers])}${await response.text()}`;
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(SECRET);
  });

  it.each([
    ["a missing password", {}],
    ["a non-string password", { password: 123 }],
  ])("rejects %s with 400", async (_label, body) => {
    const response = await login(buildApp(), body);

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("invalid_request");
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await login(buildApp(), "{not json");

    expect(response.status).toBe(400);
  });

  it("rejects same-origin non-JSON bodies with 415", async () => {
    const response = await buildApp().request("/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Sec-Fetch-Site": "same-origin",
      },
      body: `password=${PASSWORD}`,
    });

    expect(response.status).toBe(415);
  });

  it("blocks cross-site form posts with 403", async () => {
    const response = await login(
      buildApp(),
      `password=${PASSWORD}`,
      "text/plain",
    );

    expect(response.status).toBe(403);
  });

  describe("rate limiting", () => {
    it("returns 429 after too many failed attempts", async () => {
      const app = buildApp({ loginLimit: 2 });
      const wrong = { password: "wrong-password-123" };

      await login(app, wrong);
      await login(app, wrong);
      const response = await login(app, wrong);

      expect(response.status).toBe(429);
      expect((await readBody(response)).error?.code).toBe("rate_limited");
    });

    it("blocks even the correct password once limited", async () => {
      const app = buildApp({ loginLimit: 1 });

      await login(app, { password: "wrong-password-123" });
      const response = await login(app, { password: PASSWORD });

      expect(response.status).toBe(429);
    });

    it("does not count successful logins", async () => {
      const app = buildApp({ loginLimit: 1 });

      await login(app, { password: PASSWORD });
      const response = await login(app, { password: PASSWORD });

      expect(response.status).toBe(200);
    });
  });
});

describe("session persistence", () => {
  it("keeps the session across requests", async () => {
    const app = buildApp();
    const cookie = await signIn(app, "Ada");

    const first = await readBody(await currentSession(app, cookie));
    const second = await readBody(await currentSession(app, cookie));

    expect(first.collaborator?.name).toBe("Ada");
    expect(second).toEqual(first);
  });

  it("survives a server restart because sessions live in SQLite", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "astro-cms-")), "cms.sqlite");
    const firstDb = openDatabase(file);
    const cookie = await signIn(buildApp({ db: firstDb }), "Ada");
    firstDb.close();

    const restarted = buildApp({ db: openDatabase(file) });
    const response = await currentSession(restarted, cookie);

    expect(response.status).toBe(200);
    expect((await readBody(response)).collaborator?.name).toBe("Ada");
  });

  it("rejects cookies signed with a different SESSION_SECRET", async () => {
    const db = openDatabase(":memory:");
    const cookie = await signIn(buildApp({ db }), "Ada");

    const rotated = buildApp({
      db,
      secret: "a-completely-different-secret-value",
    });
    const response = await currentSession(rotated, cookie);

    expect(response.status).toBe(401);
  });
});

describe("logout", () => {
  it("ends the session and clears the cookie", async () => {
    const app = buildApp();
    const cookie = await signIn(app, "Ada");

    const response = await app.request("/api/session", {
      method: "DELETE",
      headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toMatch(
      /cms_session=;.*Max-Age=0/,
    );
    expect((await currentSession(app, cookie)).status).toBe(401);
  });

  it("succeeds without a session so the browser can always sign out", async () => {
    const response = await buildApp().request("/api/session", {
      method: "DELETE",
      headers: { "Sec-Fetch-Site": "same-origin" },
    });

    expect(response.status).toBe(204);
  });

  it("blocks cross-site logout requests", async () => {
    const app = buildApp();
    const cookie = await signIn(app);

    const response = await app.request("/api/session", {
      method: "DELETE",
      headers: {
        Cookie: cookie,
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });

    expect(response.status).toBe(403);
  });
});

describe("display name", () => {
  it("is empty right after login", async () => {
    const app = buildApp();
    const cookie = await signIn(app);

    expect(await readBody(await currentSession(app, cookie))).toEqual({
      collaborator: null,
    });
  });

  it("can be chosen after login and is returned with the session", async () => {
    const app = buildApp();
    const cookie = await signIn(app);

    const response = await chooseName(app, cookie, "  Ada  ");
    const chosen = await readBody(response);

    expect(response.status).toBe(200);
    expect(chosen.collaborator?.name).toBe("Ada");
    expect(await readBody(await currentSession(app, cookie))).toEqual(chosen);
  });

  it("reuses the same collaborator when another browser picks the same name", async () => {
    const app = buildApp();

    const first = await readBody(
      await chooseName(app, await signIn(app), "Ada"),
    );
    const second = await readBody(
      await chooseName(app, await signIn(app), "ada"),
    );

    expect(second.collaborator?.id).toBe(first.collaborator?.id);
  });

  it.each([
    ["empty", ""],
    ["too long", "a".repeat(41)],
    ["not a string", 42],
  ])("rejects a name that is %s with 400", async (_label, name) => {
    const app = buildApp();

    const response = await chooseName(app, await signIn(app), name);

    expect(response.status).toBe(400);
  });
});

describe("unauthorized API access", () => {
  it("rejects GET /api/session without a cookie", async () => {
    const response = await currentSession(buildApp());

    expect(response.status).toBe(401);
    expect((await readBody(response)).error?.code).toBe("unauthenticated");
  });

  it("rejects choosing a display name without a session", async () => {
    const response = await chooseName(buildApp(), "cms_session=forged", "Ada");

    expect(response.status).toBe(401);
  });

  it("rejects an unsigned or tampered cookie", async () => {
    const app = buildApp();
    const cookie = await signIn(app);
    const tampered = cookie.replace(/\.[^.]+$/, ".AAAA");

    expect((await currentSession(app, "cms_session=plain-token")).status).toBe(
      401,
    );
    expect((await currentSession(app, tampered)).status).toBe(401);
  });

  it("protects every other API route by default", async () => {
    const app = buildApp();

    const response = await app.request("/api/anything-else");

    expect(response.status).toBe(401);
  });

  it("returns 404 for unknown routes once authenticated", async () => {
    const app = buildApp();
    const cookie = await signIn(app);

    const response = await app.request("/api/anything-else", {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(404);
    expect((await readBody(response)).error?.code).toBe("not_found");
  });
});
