import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./database.ts";
import {
  createMediaRepository,
  type MediaRepository,
} from "./media-repository.ts";
import { createDocumentRepository } from "./document-repository.ts";

describe("media repository git references", () => {
  let db: Db;
  let media: MediaRepository;

  function add(id: string): void {
    media.insert({
      id,
      objectKey: `media/ab/${id}.png`,
      filename: `${id}.png`,
      contentType: "image/png",
      size: 10,
      sha256: id.padEnd(64, "0"),
      width: 1,
      height: 1,
      uploadedBy: null,
      uploadedAt: 1000,
    });
  }

  beforeEach(() => {
    db = openDatabase(":memory:");
    media = createMediaRepository(db);
  });

  it("counts a reference from a git ref", () => {
    add("m1");

    media.setGitReferences("main", [
      { mediaId: "m1", path: "src/content/blog/hello.md" },
    ]);

    expect(media.findById("m1")?.referenceCount).toBe(1);
  });

  it("replaces a ref's references wholesale", () => {
    add("m1");
    add("m2");
    media.setGitReferences("main", [
      { mediaId: "m1", path: "src/content/blog/a.md" },
      { mediaId: "m2", path: "src/content/blog/b.md" },
    ]);

    media.setGitReferences("main", [
      { mediaId: "m2", path: "src/content/blog/b.md" },
    ]);

    expect(media.findById("m1")?.referenceCount).toBe(0);
    expect(media.findById("m2")?.referenceCount).toBe(1);
  });

  it("counts drafts and git refs together", () => {
    add("m1");
    const documents = createDocumentRepository(db);
    documents.insert({
      id: "d1",
      collection: "blog",
      path: "src/content/blog/hello.md",
      format: "md",
      slug: "hello",
      source: "# Hi\n",
      createdBy: null,
      createdAt: 1000,
      baseCommitSha: null,
    });
    media.setReferences("d1", ["m1"]);

    media.setGitReferences("main", [
      { mediaId: "m1", path: "src/content/blog/hello.md" },
    ]);

    expect(media.findById("m1")?.referenceCount).toBe(2);
  });

  it("forgets a ref entirely", () => {
    add("m1");
    media.setGitReferences("cms/blog/hello", [
      { mediaId: "m1", path: "src/content/blog/hello.md" },
    ]);

    media.deleteGitReferences("cms/blog/hello");

    expect(media.findById("m1")?.referenceCount).toBe(0);
    expect(media.listGitRefs()).toEqual([]);
  });

  it("lists the refs it holds references for", () => {
    add("m1");
    media.setGitReferences("main", [{ mediaId: "m1", path: "a.md" }]);
    media.setGitReferences("cms/blog/x", [{ mediaId: "m1", path: "a.md" }]);

    expect(media.listGitRefs().sort()).toEqual(["cms/blog/x", "main"]);
  });

  it("keeps a git-referenced file out of the unused list", () => {
    add("m1");
    add("m2");
    media.setGitReferences("main", [{ mediaId: "m1", path: "a.md" }]);

    media.refreshUnusedMarkers(5000);

    expect(media.list({ unusedOnly: true, limit: 10, offset: 0 })).toHaveLength(
      1,
    );
    expect(media.findById("m1")?.unusedSince).toBeNull();
    expect(media.findById("m2")?.unusedSince).toBe(5000);
  });

  describe("findDeletable", () => {
    it("returns only files marked before the cutoff", () => {
      add("old");
      add("recent");
      media.refreshUnusedMarkers(1000);
      add("fresh");
      media.refreshUnusedMarkers(9000);

      const deletable = media.findDeletable(5000);

      expect(deletable.map((m) => m.id).sort()).toEqual(["old", "recent"]);
    });

    it("never returns a file that is referenced again", () => {
      add("m1");
      media.refreshUnusedMarkers(1000);
      media.setGitReferences("main", [{ mediaId: "m1", path: "a.md" }]);

      expect(media.findDeletable(9000)).toEqual([]);
    });
  });
});
