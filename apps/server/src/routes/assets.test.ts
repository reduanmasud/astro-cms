import { describe, expect, it } from "vitest";
import { buildTestApp, requestJson, signIn } from "../test-support/app.ts";

describe("GET /api/repo-asset", () => {
  it("serves a file already in the repository, with a content type from its extension", async () => {
    const { app } = buildTestApp({
      files: { "public/images/hero.png": "pretend-png-bytes" },
    });
    const cookie = await signIn(app);

    const response = await requestJson(
      app,
      cookie,
      "GET",
      "/api/repo-asset?path=public/images/hero.png",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("pretend-png-bytes");
  });

  it("requires a session", async () => {
    const { app } = buildTestApp({
      files: { "public/hero.png": "pretend-png-bytes" },
    });

    const response = await app.request("/api/repo-asset?path=public/hero.png");

    expect(response.status).toBe(401);
  });

  it("404s for a path with no file", async () => {
    const { app } = buildTestApp();
    const cookie = await signIn(app);

    const response = await requestJson(
      app,
      cookie,
      "GET",
      "/api/repo-asset?path=no/such/file.png",
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("400s when path is missing", async () => {
    const { app } = buildTestApp();
    const cookie = await signIn(app);

    const response = await requestJson(app, cookie, "GET", "/api/repo-asset");
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("missing_path");
  });

  it("415s for a file type it does not serve as an image", async () => {
    const { app } = buildTestApp({
      files: { "public/notes.txt": "just text" },
    });
    const cookie = await signIn(app);

    const response = await requestJson(
      app,
      cookie,
      "GET",
      "/api/repo-asset?path=public/notes.txt",
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(415);
    expect(body.error.code).toBe("unsupported_type");
  });

  it("refuses a path that tries to escape the repository", async () => {
    const { app } = buildTestApp();
    const cookie = await signIn(app);

    const response = await requestJson(
      app,
      cookie,
      "GET",
      "/api/repo-asset?path=../../etc/passwd.png",
    );

    expect(response.status).toBe(500);
  });
});
