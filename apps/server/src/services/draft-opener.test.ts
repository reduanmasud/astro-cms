import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.ts";
import { createDocumentRepository } from "../db/document-repository.ts";
import type { CollaboratorRef } from "../documents/model.ts";
import { createFakeGitHubClient } from "../github/fake.ts";
import { TEST_FILES } from "../test-support/app.ts";
import { createAstroProjectService } from "./astro-project.ts";
import { createDocumentService } from "./documents.ts";
import { createDraftOpener } from "./draft-opener.ts";
import { createRepositoryService } from "./repository.ts";

const ADA: CollaboratorRef = { id: "c1", name: "Ada" };

function setup() {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO collaborators VALUES ('c1', 'Ada', 1, 1)").run();
  const github = createFakeGitHubClient({ files: TEST_FILES });
  const repository = createRepositoryService({
    github: github.client,
    baseBranch: "main",
  });
  const documents = createDocumentService({
    repository: createDocumentRepository(db),
  });
  const opener = createDraftOpener({
    documents,
    repository,
    project: createAstroProjectService({ repository }),
  });
  return { github, documents, opener };
}

async function failure(
  run: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("draft opener", () => {
  it("opens an existing file as a draft with its source and base commit", async () => {
    const { github, opener } = setup();

    const { document, created } = await opener.open(
      { collection: "blog", path: "src/content/blog/hello.md" },
      ADA,
    );

    expect(created).toBe(true);
    expect(document).toMatchObject({
      collection: "blog",
      path: "src/content/blog/hello.md",
      format: "md",
      slug: "hello",
      source: TEST_FILES["src/content/blog/hello.md"],
      createdBy: ADA,
      publication: { baseCommitSha: github.headOf("main") },
    });
  });

  it("returns the existing draft instead of reading GitHub again", async () => {
    const { opener, documents } = setup();
    const first = await opener.open(
      { collection: "blog", path: "src/content/blog/hello.md" },
      ADA,
    );
    documents.update(first.document.id, { source: "edited" }, ADA);

    const second = await opener.open(
      { collection: "blog", path: "src/content/blog/hello.md" },
      ADA,
    );

    expect(second.created).toBe(false);
    expect(second.document.source).toBe("edited");
  });

  it("starts a new, empty draft for a path that does not exist yet", async () => {
    const { opener } = setup();

    const { document } = await opener.open(
      { collection: "blog", path: "src/content/blog/new-post.mdx" },
      ADA,
    );

    expect(document).toMatchObject({
      source: "",
      format: "mdx",
      slug: "new-post",
    });
  });

  it.each([
    [
      "an unknown collection",
      { collection: "nope", path: "src/content/blog/a.md" },
      "not_found",
    ],
    [
      "a path outside the collection",
      { collection: "blog", path: "src/pages/a.md" },
      "invalid",
    ],
    [
      "an unsupported format",
      { collection: "blog", path: "src/content/blog/a.txt" },
      "invalid",
    ],
  ])("rejects %s", async (_label, input, code) => {
    const { opener } = setup();

    expect(await failure(() => opener.open(input, ADA))).toBe(code);
  });

  it("never writes to GitHub while drafting", async () => {
    const { github, opener, documents } = setup();
    const head = github.headOf("main");

    const { document } = await opener.open(
      { collection: "blog", path: "src/content/blog/hello.md" },
      ADA,
    );
    documents.update(document.id, { source: "changed" }, ADA);
    documents.delete(document.id);

    expect(github.headOf("main")).toBe(head);
    expect(github.branchNames()).toEqual(["main"]);
    expect(github.pullRequestCount()).toBe(0);
  });
});
