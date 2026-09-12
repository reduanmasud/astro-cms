import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database.ts";
import { createDocumentRepository } from "../db/document-repository.ts";
import {
  createMediaRepository,
  type MediaRepository,
} from "../db/media-repository.ts";
import type { CollaboratorRef } from "../documents/model.ts";
import { createDocumentService, type DocumentService } from "./documents.ts";
import {
  createMediaReferenceTracker,
  type MediaReferenceTracker,
} from "./media-references.ts";

const ADA: CollaboratorRef = { id: "c1", name: "Ada" };
const PUBLIC_URL = "https://media.test";

describe("media reference tracking", () => {
  let db: Db;
  let repository: MediaRepository;
  let documents: DocumentService;
  let tracker: MediaReferenceTracker;
  let now: number;

  /** Inserts a media row directly; uploading is covered elsewhere. */
  function media(id: string, key: string): string {
    repository.insert({
      id,
      objectKey: key,
      filename: `${id}.png`,
      contentType: "image/png",
      size: 10,
      sha256: id.padEnd(64, "0"),
      width: 1,
      height: 1,
      uploadedBy: ADA.id,
      uploadedAt: 1000,
    });
    return `${PUBLIC_URL}/${key}`;
  }

  function draft(path: string, source: string): string {
    return documents.create({ collection: "blog", path, source }, ADA).id;
  }

  beforeEach(() => {
    now = 5000;
    db = openDatabase(":memory:");
    db.prepare("INSERT INTO collaborators VALUES ('c1','Ada',1,1)").run();
    repository = createMediaRepository(db);
    documents = createDocumentService({
      repository: createDocumentRepository(db),
    });
    tracker = createMediaReferenceTracker({
      repository,
      documents,
      publicUrl: PUBLIC_URL,
      now: () => now,
    });
  });

  it("counts a file used in Markdown", () => {
    const url = media("m1", "media/ab/one.png");
    draft("src/content/blog/a.md", `# Hi\n\n![hero](${url})\n`);

    const summary = tracker.recompute();

    expect(summary).toEqual({ documents: 1, references: 1 });
    expect(repository.findById("m1")?.referenceCount).toBe(1);
  });

  it("finds files in MDX components and raw HTML too", () => {
    const url = media("m1", "media/ab/one.png");
    draft(
      "src/content/blog/a.md",
      `<Hero src="${url}" />\n\n<img src="${url}">\n`,
    );

    tracker.recompute();

    expect(repository.findById("m1")?.referenceCount).toBe(1);
  });

  it("counts one file used by two drafts once per draft", () => {
    const url = media("m1", "media/ab/one.png");
    draft("src/content/blog/a.md", `![](${url})`);
    draft("src/content/blog/b.md", `![](${url})`);

    expect(tracker.recompute()).toEqual({ documents: 2, references: 2 });
    expect(repository.findById("m1")?.referenceCount).toBe(2);
  });

  it("ignores URLs that are not ours", () => {
    media("m1", "media/ab/one.png");
    draft("src/content/blog/a.md", "![](https://example.com/media/ab/one.png)");

    tracker.recompute();

    expect(repository.findById("m1")?.referenceCount).toBe(0);
  });

  it("stamps unused files and clears the stamp when they are used again", () => {
    const url = media("m1", "media/ab/one.png");
    const id = draft("src/content/blog/a.md", "no images here");

    tracker.recompute();
    expect(repository.findById("m1")?.unusedSince).toBe(5000);

    documents.update(id, { source: `![](${url})` }, ADA);
    now = 6000;
    tracker.recompute();

    expect(repository.findById("m1")).toMatchObject({
      unusedSince: null,
      referenceCount: 1,
    });
  });

  it("drops references when a draft stops using a file", () => {
    const url = media("m1", "media/ab/one.png");
    const id = draft("src/content/blog/a.md", `![](${url})`);
    tracker.recompute();

    documents.update(id, { source: "text only" }, ADA);
    tracker.syncDocument(id);

    expect(repository.findById("m1")).toMatchObject({
      referenceCount: 0,
      unusedSince: 5000,
    });
  });

  it("drops references when the draft is deleted", () => {
    const url = media("m1", "media/ab/one.png");
    const id = draft("src/content/blog/a.md", `![](${url})`);
    tracker.recompute();

    documents.delete(id);

    expect(repository.findById("m1")?.referenceCount).toBe(0);
  });

  it("does nothing when media storage is off", () => {
    media("m1", "media/ab/one.png");
    draft("src/content/blog/a.md", `![](${PUBLIC_URL}/media/ab/one.png)`);
    const offline = createMediaReferenceTracker({
      repository,
      documents,
      publicUrl: null,
      now: () => now,
    });

    expect(offline.recompute()).toEqual({ documents: 1, references: 0 });
  });
});
