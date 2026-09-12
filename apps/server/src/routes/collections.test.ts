import { describe, expect, it } from "vitest";
import { GitHubError } from "../github/client.ts";
import { buildTestApp, requestJson, signIn } from "../test-support/app.ts";

interface ProjectBody {
  isAstroProject: boolean;
  contentConfigPath: string | null;
  collections: {
    name: string;
    contentPath: string | null;
    formats: string[];
    entryCount: number | null;
    schema: {
      inferred: boolean;
      fields?: { name: string; type: string; required: boolean }[];
    };
  }[];
}

interface DetailBody {
  collection: { name: string };
  entries: { path: string; format: string }[];
  error?: { code: string };
}

describe("GET /api/collections", () => {
  it("lists collections with path, formats, and schema fields", async () => {
    const { app } = buildTestApp();
    const cookie = await signIn(app);

    const response = await requestJson(app, cookie, "GET", "/api/collections");
    const body = (await response.json()) as ProjectBody;

    expect(response.status).toBe(200);
    expect(body.isAstroProject).toBe(true);
    expect(body.contentConfigPath).toBe("src/content.config.ts");
    expect(body.collections).toEqual([
      {
        name: "blog",
        loader: "glob",
        contentPath: "src/content/blog",
        pattern: "**/*.{md,mdx}",
        formats: ["md", "mdx"],
        entryCount: 1,
        schema: {
          inferred: true,
          fields: [
            { name: "title", type: "string", required: true },
            { name: "draft", type: "boolean", required: false },
          ],
        },
      },
    ]);
  });

  it("requires a session", async () => {
    const { app } = buildTestApp();

    const response = await app.request("/api/collections");

    expect(response.status).toBe(401);
  });

  it("returns 502 when GitHub cannot be reached", async () => {
    const { app, github } = buildTestApp();
    const cookie = await signIn(app);
    github.client.getBranchHead = () =>
      Promise.reject(new GitHubError(503, "GitHub is down"));

    const response = await requestJson(app, cookie, "GET", "/api/collections");
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("github_unavailable");
    expect(body.error.message).toContain("GitHub is down");
  });
});

describe("GET /api/collections/:collection", () => {
  it("returns one collection with its entries", async () => {
    const { app } = buildTestApp();
    const cookie = await signIn(app);

    const response = await requestJson(
      app,
      cookie,
      "GET",
      "/api/collections/blog",
    );
    const body = (await response.json()) as DetailBody;

    expect(response.status).toBe(200);
    expect(body.collection.name).toBe("blog");
    expect(body.entries).toEqual([
      { path: "src/content/blog/hello.md", format: "md" },
    ]);
  });

  it("returns 404 for an unknown collection", async () => {
    const { app } = buildTestApp();
    const cookie = await signIn(app);

    const response = await requestJson(
      app,
      cookie,
      "GET",
      "/api/collections/nope",
    );
    const body = (await response.json()) as DetailBody;

    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("collection_not_found");
  });
});
