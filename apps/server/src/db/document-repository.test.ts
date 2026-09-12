import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./database.ts";
import {
  createDocumentRepository,
  type DocumentRepository,
  type NewDocumentRecord,
} from "./document-repository.ts";

function record(overrides: Partial<NewDocumentRecord> = {}): NewDocumentRecord {
  return {
    id: "doc-1",
    collection: "blog",
    path: "src/content/blog/hello.md",
    format: "md",
    slug: "hello",
    source: "# Hello\n",
    createdBy: "c1",
    createdAt: 1000,
    baseCommitSha: "abc123",
    ...overrides,
  };
}

describe("document repository (SQLite)", () => {
  let db: Db;
  let documents: DocumentRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    db.prepare(
      "INSERT INTO collaborators VALUES ('c1', 'Ada', 1, 1), ('c2', 'Grace', 1, 1)",
    ).run();
    documents = createDocumentRepository(db);
  });

  it("inserts and reads a document with collaborator names and publication fields", () => {
    documents.insert(record());

    expect(documents.findById("doc-1")).toEqual({
      id: "doc-1",
      collection: "blog",
      path: "src/content/blog/hello.md",
      format: "md",
      slug: "hello",
      source: "# Hello\n",
      status: "draft",
      revision: 1,
      createdBy: { id: "c1", name: "Ada" },
      updatedBy: { id: "c1", name: "Ada" },
      createdAt: 1000,
      updatedAt: 1000,
      publication: {
        baseCommitSha: "abc123",
        branch: null,
        pullRequestNumber: null,
        pullRequestUrl: null,
        publishedCommitSha: null,
        publishedAt: null,
      },
    });
  });

  it("finds by path and returns undefined when missing", () => {
    documents.insert(record());

    expect(documents.findByPath("src/content/blog/hello.md")?.id).toBe("doc-1");
    expect(documents.findByPath("nope.md")).toBeUndefined();
    expect(documents.findById("nope")).toBeUndefined();
  });

  it("enforces one document per path", () => {
    documents.insert(record());

    expect(() => documents.insert(record({ id: "doc-2" }))).toThrow(/UNIQUE/);
  });

  it("updates only the given fields, bumps the revision, and records the updater", () => {
    documents.insert(record());

    const updated = documents.update("doc-1", {
      source: "# Changed\n",
      updatedBy: "c2",
      updatedAt: 2000,
    });

    expect(updated).toBe(true);
    expect(documents.findById("doc-1")).toMatchObject({
      source: "# Changed\n",
      slug: "hello",
      revision: 2,
      updatedBy: { id: "c2", name: "Grace" },
      updatedAt: 2000,
      createdAt: 1000,
    });
  });

  it("refuses an update based on a stale revision", () => {
    documents.insert(record());
    documents.update(
      "doc-1",
      { source: "v2", updatedBy: "c1", updatedAt: 2000 },
      1,
    );

    const stale = documents.update(
      "doc-1",
      { source: "v3", updatedBy: "c2", updatedAt: 3000 },
      1,
    );

    expect(stale).toBe(false);
    expect(documents.findById("doc-1")?.source).toBe("v2");
  });

  it("deletes a document", () => {
    documents.insert(record());

    expect(documents.delete("doc-1")).toBe(true);
    expect(documents.delete("doc-1")).toBe(false);
    expect(documents.findById("doc-1")).toBeUndefined();
  });

  it("keeps documents when a collaborator is removed", () => {
    documents.insert(record());
    db.prepare("DELETE FROM collaborators WHERE id = 'c1'").run();

    expect(documents.findById("doc-1")?.createdBy).toBeNull();
  });

  describe("list", () => {
    beforeEach(() => {
      documents.insert(
        record({
          id: "a",
          path: "src/content/blog/a.md",
          slug: "a",
          createdAt: 1,
        }),
      );
      documents.insert(
        record({
          id: "b",
          path: "src/content/blog/b.mdx",
          format: "mdx",
          slug: "b",
          createdAt: 2,
        }),
      );
      documents.insert(
        record({
          id: "c",
          collection: "docs",
          path: "src/content/docs/c.md",
          slug: "c",
          createdAt: 3,
        }),
      );
    });

    it("lists newest first without the source", () => {
      const list = documents.list({ limit: 10, offset: 0 });

      expect(list.map((doc) => doc.id)).toEqual(["c", "b", "a"]);
      expect(list[0]).not.toHaveProperty("source");
    });

    it("filters by collection and status, and pages", () => {
      documents.update("a", {
        status: "in_review",
        updatedBy: "c1",
        updatedAt: 1,
      });

      expect(
        documents
          .list({ collection: "blog", limit: 10, offset: 0 })
          .map((d) => d.id),
      ).toEqual(["b", "a"]);
      expect(
        documents
          .list({ status: "in_review", limit: 10, offset: 0 })
          .map((d) => d.id),
      ).toEqual(["a"]);
      expect(documents.list({ limit: 1, offset: 1 }).map((d) => d.id)).toEqual([
        "b",
      ]);
    });

    it("searches path, slug, and source case-insensitively", () => {
      documents.update("b", {
        source: "Deploying ASTRO sites",
        updatedBy: "c1",
        updatedAt: 5,
      });

      expect(
        documents
          .list({ search: "astro", limit: 10, offset: 0 })
          .map((d) => d.id),
      ).toEqual(["b"]);
      expect(
        documents
          .list({ search: "docs/c", limit: 10, offset: 0 })
          .map((d) => d.id),
      ).toEqual(["c"]);
    });

    it("treats % and _ in the search text literally", () => {
      documents.update("a", {
        source: "100% done",
        updatedBy: "c1",
        updatedAt: 5,
      });

      expect(
        documents.list({ search: "%", limit: 10, offset: 0 }).map((d) => d.id),
      ).toEqual(["a"]);
      expect(documents.list({ search: "_", limit: 10, offset: 0 })).toEqual([]);
    });
  });

  describe("publication", () => {
    it("records a publish without bumping the revision", () => {
      documents.insert(record());

      documents.setPublication("doc-1", {
        branch: "cms/blog/hello",
        pullRequestNumber: 7,
        pullRequestUrl: "https://github.com/acme/blog/pull/7",
        publishedCommitSha: "sha0002",
        publishedAt: 2000,
        status: "in_review",
      });

      const document = documents.findById("doc-1");
      // An open editor holds a revision; publishing must not invalidate it.
      expect(document?.revision).toBe(1);
      expect(document?.status).toBe("in_review");
      expect(document?.publication).toEqual({
        baseCommitSha: "abc123",
        branch: "cms/blog/hello",
        pullRequestNumber: 7,
        pullRequestUrl: "https://github.com/acme/blog/pull/7",
        publishedCommitSha: "sha0002",
        publishedAt: 2000,
      });
    });

    it("moves the baseline and the status on their own", () => {
      documents.insert(record());

      documents.setBaseCommit("doc-1", "sha0099");
      documents.setStatus("doc-1", "published");

      const document = documents.findById("doc-1");
      expect(document?.publication.baseCommitSha).toBe("sha0099");
      expect(document?.status).toBe("published");
      // Neither touches the draft itself.
      expect(document?.source).toBe("# Hello\n");
      expect(document?.revision).toBe(1);
    });
  });
});
