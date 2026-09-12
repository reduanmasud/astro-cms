import { beforeEach, describe, expect, it } from "vitest";
import type { CmsDocument, DocumentSummary } from "../documents/model.ts";
import {
  buildTestApp,
  requestJson,
  signIn,
  type TestApp,
} from "../test-support/app.ts";

interface DocumentBody {
  document?: CmsDocument;
  documents?: DocumentSummary[];
  created?: boolean;
  error?: { code: string; message: string; currentRevision?: number };
}

const HELLO = { collection: "blog", path: "src/content/blog/hello.md" };

describe("documents API", () => {
  let harness: TestApp;
  let cookie: string;

  beforeEach(async () => {
    harness = buildTestApp();
    cookie = await signIn(harness.app, "Ada");
  });

  function call(method: string, path: string, body?: unknown) {
    return requestJson(harness.app, cookie, method, path, body);
  }

  async function read(response: Response): Promise<DocumentBody> {
    return (await response.json()) as DocumentBody;
  }

  async function openHello(): Promise<CmsDocument> {
    const body = await read(await call("POST", "/api/documents", HELLO));
    if (!body.document) throw new Error("no document");
    return body.document;
  }

  describe("POST /api/documents", () => {
    it("opens a repository file as a draft", async () => {
      const response = await call("POST", "/api/documents", HELLO);
      const body = await read(response);

      expect(response.status).toBe(201);
      expect(body.created).toBe(true);
      expect(body.document).toMatchObject({
        collection: "blog",
        path: HELLO.path,
        format: "md",
        slug: "hello",
        status: "draft",
        createdBy: { name: "Ada" },
      });
      expect(body.document?.source).toContain("# Hello");
    });

    it("returns the existing draft on a second open", async () => {
      await openHello();

      const response = await call("POST", "/api/documents", HELLO);

      expect(response.status).toBe(200);
      expect((await read(response)).created).toBe(false);
    });

    it.each([
      [
        "an unknown collection",
        { collection: "nope", path: "src/content/blog/a.md" },
        404,
      ],
      [
        "a path outside the collection",
        { collection: "blog", path: "src/pages/a.md" },
        400,
      ],
      ["a missing path", { collection: "blog" }, 400],
    ])("rejects %s", async (_label, body, status) => {
      expect((await call("POST", "/api/documents", body)).status).toBe(status);
    });

    it("requires a display name", async () => {
      const app = buildTestApp();
      const nameless = await signIn(app.app);

      const response = await requestJson(
        app.app,
        nameless,
        "POST",
        "/api/documents",
        HELLO,
      );

      expect(response.status).toBe(403);
      expect((await read(response)).error?.code).toBe("display_name_required");
    });

    it("requires a session", async () => {
      const response = await harness.app.request("/api/documents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify(HELLO),
      });

      expect(response.status).toBe(401);
    });

    it("blocks cross-site writes before checking the session", async () => {
      const response = await harness.app.request("/api/documents", {
        method: "POST",
      });

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/documents", () => {
    beforeEach(async () => {
      await openHello();
      await call("POST", "/api/documents", {
        collection: "blog",
        path: "src/content/blog/second.mdx",
      });
    });

    it("lists drafts without their source", async () => {
      const body = await read(await call("GET", "/api/documents"));

      expect(body.documents?.map((doc) => doc.path)).toEqual([
        "src/content/blog/second.mdx",
        "src/content/blog/hello.md",
      ]);
      expect(body.documents?.[0]).not.toHaveProperty("source");
    });

    it("filters by collection and status and searches", async () => {
      expect(
        (await read(await call("GET", "/api/documents?collection=blog")))
          .documents,
      ).toHaveLength(2);
      expect(
        (await read(await call("GET", "/api/documents?collection=none")))
          .documents,
      ).toEqual([]);
      expect(
        (await read(await call("GET", "/api/documents?status=published")))
          .documents,
      ).toEqual([]);
      expect(
        (
          await read(await call("GET", "/api/documents?q=hello"))
        ).documents?.map((d) => d.slug),
      ).toEqual(["hello"]);
    });

    it("rejects bad paging", async () => {
      expect((await call("GET", "/api/documents?limit=0")).status).toBe(400);
      expect((await call("GET", "/api/documents?limit=abc")).status).toBe(400);
    });
  });

  describe("GET /api/documents/:id", () => {
    it("returns a draft with its source", async () => {
      const doc = await openHello();

      const body = await read(await call("GET", `/api/documents/${doc.id}`));

      expect(body.document?.source).toBe(doc.source);
    });

    it("returns 404 for an unknown id", async () => {
      expect((await call("GET", "/api/documents/missing")).status).toBe(404);
    });
  });

  describe("PATCH /api/documents/:id", () => {
    it("saves a new source and bumps the revision", async () => {
      const doc = await openHello();

      const body = await read(
        await call("PATCH", `/api/documents/${doc.id}`, {
          source: "# Edited\n",
          expectedRevision: 1,
        }),
      );

      expect(body.document).toMatchObject({
        source: "# Edited\n",
        revision: 2,
        updatedBy: { name: "Ada" },
      });
    });

    it("reports a conflict with the current revision", async () => {
      const doc = await openHello();
      await call("PATCH", `/api/documents/${doc.id}`, { source: "v2" });

      const response = await call("PATCH", `/api/documents/${doc.id}`, {
        source: "v3",
        expectedRevision: 1,
      });
      const body = await read(response);

      expect(response.status).toBe(409);
      expect(body.error?.code).toBe("conflict");
      expect(body.error?.currentRevision).toBe(2);
    });

    it("rejects an empty change set and an unknown status", async () => {
      const doc = await openHello();

      expect((await call("PATCH", `/api/documents/${doc.id}`, {})).status).toBe(
        400,
      );
      expect(
        (await call("PATCH", `/api/documents/${doc.id}`, { status: "nope" }))
          .status,
      ).toBe(400);
    });
  });

  describe("DELETE /api/documents/:id", () => {
    it("deletes a draft and leaves the repository untouched", async () => {
      const doc = await openHello();
      const head = harness.github.headOf("main");

      const response = await call("DELETE", `/api/documents/${doc.id}`);

      expect(response.status).toBe(204);
      expect((await call("GET", `/api/documents/${doc.id}`)).status).toBe(404);
      expect(harness.github.headOf("main")).toBe(head);
      expect(harness.github.branchNames()).toEqual(["main"]);
    });
  });
});
