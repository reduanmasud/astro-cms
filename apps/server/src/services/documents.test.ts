import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.ts";
import { createDocumentRepository } from "../db/document-repository.ts";
import type { CollaboratorRef } from "../documents/model.ts";
import {
  createDocumentService,
  DocumentError,
  MAX_SOURCE_BYTES,
  type DocumentService,
} from "./documents.ts";

const ADA: CollaboratorRef = { id: "c1", name: "Ada" };
const GRACE: CollaboratorRef = { id: "c2", name: "Grace" };

describe("document service", () => {
  let now: number;
  let documents: DocumentService;

  beforeEach(() => {
    now = 1000;
    const db = openDatabase(":memory:");
    db.prepare(
      "INSERT INTO collaborators VALUES ('c1', 'Ada', 1, 1), ('c2', 'Grace', 1, 1)",
    ).run();
    let nextId = 1;
    documents = createDocumentService({
      repository: createDocumentRepository(db),
      now: () => now,
      newId: () => `doc-${nextId++}`,
    });
  });

  function create(path = "src/content/blog/hello.md", extra = {}) {
    return documents.create({ collection: "blog", path, ...extra }, ADA);
  }

  function errorCode(run: () => unknown): string | undefined {
    try {
      run();
    } catch (error) {
      if (error instanceof DocumentError) return error.code;
      throw error;
    }
    return undefined;
  }

  describe("create", () => {
    it("creates a draft with format, slug, creator, and timestamps", () => {
      const doc = create("src/content/blog/nested/World.mdx", {
        contentPath: "src/content/blog",
        source: "# World\n",
        baseCommitSha: "abc123",
      });

      expect(doc).toMatchObject({
        id: "doc-1",
        collection: "blog",
        path: "src/content/blog/nested/World.mdx",
        format: "mdx",
        slug: "nested/world",
        source: "# World\n",
        status: "draft",
        revision: 1,
        createdBy: ADA,
        updatedBy: ADA,
        createdAt: 1000,
        updatedAt: 1000,
        publication: { baseCommitSha: "abc123", branch: null },
      });
    });

    it("defaults to an empty source and a file-name slug", () => {
      expect(create()).toMatchObject({ source: "", slug: "hello" });
    });

    it("accepts an explicit slug", () => {
      expect(create(undefined, { slug: "custom/slug" }).slug).toBe(
        "custom/slug",
      );
    });

    it.each([
      ["a path outside the repository", { path: "../secret.md" }],
      ["a non-Markdown file", { path: "src/content/blog/data.json" }],
      ["an invalid slug", { slug: "Not Valid!" }],
      ["an invalid collection name", { collection: "bad name" }],
      ["an oversized source", { source: "x".repeat(MAX_SOURCE_BYTES + 1) }],
    ])("rejects %s", (_label, override) => {
      expect(
        errorCode(() =>
          documents.create(
            { collection: "blog", path: "src/content/blog/a.md", ...override },
            ADA,
          ),
        ),
      ).toBe("invalid");
    });

    it("rejects a second document for the same path", () => {
      create();

      expect(errorCode(() => create())).toBe("already_exists");
    });
  });

  describe("get", () => {
    it("returns a document by id and throws not_found otherwise", () => {
      const doc = create();

      expect(documents.get(doc.id)).toEqual(doc);
      expect(errorCode(() => documents.get("missing"))).toBe("not_found");
    });

    it("finds a document by path", () => {
      const doc = create();

      expect(documents.findByPath(doc.path)?.id).toBe(doc.id);
      expect(documents.findByPath("src/content/blog/none.md")).toBeUndefined();
    });
  });

  describe("update", () => {
    it("changes the source and records the updater", () => {
      const doc = create();
      now = 2000;

      const updated = documents.update(doc.id, { source: "# New\n" }, GRACE);

      expect(updated).toMatchObject({
        source: "# New\n",
        revision: 2,
        createdBy: ADA,
        updatedBy: GRACE,
        updatedAt: 2000,
      });
    });

    it("updates slug and status", () => {
      const doc = create();

      expect(
        documents.update(doc.id, { slug: "renamed", status: "in_review" }, ADA),
      ).toMatchObject({
        slug: "renamed",
        status: "in_review",
      });
    });

    it("rejects a stale revision with the current one", () => {
      const doc = create();
      documents.update(doc.id, { source: "v2" }, ADA);

      let error: unknown;
      try {
        documents.update(doc.id, { source: "v3", expectedRevision: 1 }, GRACE);
      } catch (caught) {
        error = caught;
      }

      expect(error).toMatchObject({ code: "conflict", currentRevision: 2 });
      expect(documents.get(doc.id).source).toBe("v2");
    });

    it("accepts the current revision", () => {
      const doc = create();

      expect(
        documents.update(doc.id, { source: "v2", expectedRevision: 1 }, ADA)
          .revision,
      ).toBe(2);
    });

    it.each([
      ["no changes", {}],
      ["an unknown status", { status: "archived" }],
      ["an invalid slug", { slug: "" }],
    ])("rejects %s", (_label, input) => {
      const doc = create();

      expect(
        errorCode(() => documents.update(doc.id, input as never, ADA)),
      ).toBe("invalid");
    });

    it("throws not_found for an unknown document", () => {
      expect(
        errorCode(() => documents.update("missing", { source: "x" }, ADA)),
      ).toBe("not_found");
    });
  });

  describe("delete", () => {
    it("removes a document", () => {
      const doc = create();

      documents.delete(doc.id);

      expect(errorCode(() => documents.get(doc.id))).toBe("not_found");
      expect(errorCode(() => documents.delete(doc.id))).toBe("not_found");
    });
  });

  describe("list and search", () => {
    beforeEach(() => {
      create("src/content/blog/a.md", { source: "Astro tips" });
      now = 2000;
      create("src/content/blog/b.md", { source: "Other" });
    });

    it("lists newest first with a default page size", () => {
      expect(documents.list().map((doc) => doc.path)).toEqual([
        "src/content/blog/b.md",
        "src/content/blog/a.md",
      ]);
    });

    it("searches by text", () => {
      expect(documents.search("astro").map((doc) => doc.path)).toEqual([
        "src/content/blog/a.md",
      ]);
    });

    it("rejects an empty search and out-of-range paging", () => {
      expect(errorCode(() => documents.search("   "))).toBe("invalid");
      expect(errorCode(() => documents.list({ limit: 0 }))).toBe("invalid");
      expect(errorCode(() => documents.list({ limit: 1000 }))).toBe("invalid");
      expect(errorCode(() => documents.list({ offset: -1 }))).toBe("invalid");
    });
  });
});
