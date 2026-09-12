import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database.ts";
import {
  createDocumentRepository,
  type DocumentRepository,
} from "../db/document-repository.ts";
import { createFakeGitHubClient, type FakeGitHub } from "../github/fake.ts";
import type { CollaboratorRef } from "../documents/model.ts";
import { createDocumentService, type DocumentService } from "./documents.ts";
import { createRepositoryService } from "./repository.ts";
import {
  createPublishService,
  PublishError,
  type PublishService,
} from "./publish.ts";

const ADA: CollaboratorRef = { id: "c1", name: "Ada" };
const FILES = { "src/content/blog/hello.md": "---\ntitle: Hello\n---\n" };

describe("publish service", () => {
  let db: Db;
  let github: FakeGitHub;
  let documents: DocumentService;
  let documentRepository: DocumentRepository;
  let publish: PublishService;

  beforeEach(() => {
    db = openDatabase(":memory:");
    db.prepare("INSERT INTO collaborators VALUES ('c1','Ada',1,1)").run();
    github = createFakeGitHubClient({ files: FILES });
    documentRepository = createDocumentRepository(db);
    documents = createDocumentService({ repository: documentRepository });
    publish = createPublishService({
      documents,
      documentRepository,
      repository: createRepositoryService({
        github: github.client,
        baseBranch: "main",
      }),
      now: () => 5000,
    });
  });

  /** A draft whose baseline matches the base branch, so it can publish. */
  function draft(source = "# Hi\n"): string {
    return documents.create(
      {
        collection: "blog",
        path: "src/content/blog/hello.md",
        source,
        baseCommitSha: github.headOf("main"),
      },
      ADA,
    ).id;
  }

  async function codeOf(
    run: () => Promise<unknown>,
  ): Promise<string | undefined> {
    try {
      await run();
      return undefined;
    } catch (error) {
      if (error instanceof PublishError) return error.code;
      throw error;
    }
  }

  it("creates a branch, a commit, and a pull request", async () => {
    const id = draft();

    const result = await publish.publish(id, ADA);

    expect(result.createdBranch).toBe(true);
    expect(result.createdPullRequest).toBe(true);
    expect(github.branchNames()).toContain("cms/blog/hello");
    expect(result.pullRequest.base).toBe("main");
    expect(result.document.status).toBe("in_review");
    expect(result.document.publication).toMatchObject({
      branch: "cms/blog/hello",
      pullRequestNumber: result.pullRequest.number,
      publishedCommitSha: result.commitSha,
      publishedAt: 5000,
    });
  });

  it("writes the draft's source to the file's path", async () => {
    const id = draft("# Published\n");

    await publish.publish(id, ADA);

    await expect(
      github.client.readFile("src/content/blog/hello.md", "cms/blog/hello"),
    ).resolves.toBe("# Published\n");
  });

  it("reuses the same branch and pull request on a second publish", async () => {
    const id = draft();
    const first = await publish.publish(id, ADA);
    documents.update(id, { source: "# Again\n" }, ADA);

    const second = await publish.publish(id, ADA);

    expect(second.createdBranch).toBe(false);
    expect(second.createdPullRequest).toBe(false);
    expect(second.pullRequest.number).toBe(first.pullRequest.number);
    expect(github.pullRequestCount()).toBe(1);
    expect(second.commitSha).not.toBe(first.commitSha);
  });

  it("refuses to publish when the base branch moved, and writes nothing", async () => {
    const id = draft();
    // Someone else commits to the base branch.
    await github.client.commit({
      branch: "main",
      message: "unrelated",
      changes: [{ path: "README.md", content: "hi" }],
    });
    const branchesBefore = github.branchNames().length;

    expect(await codeOf(() => publish.publish(id, ADA))).toBe("drift");
    expect(github.branchNames()).toHaveLength(branchesBefore);
    expect(github.pullRequestCount()).toBe(0);
  });

  it("reports the drift with the base branch's version of the file", async () => {
    const id = draft();
    await github.client.commit({
      branch: "main",
      message: "edit the same file",
      changes: [{ path: "src/content/blog/hello.md", content: "# Theirs\n" }],
    });

    const report = await publish.drift(id);

    expect(report.drifted).toBe(true);
    expect(report.baseContent).toBe("# Theirs\n");
    expect(report.headSha).toBe(github.headOf("main"));
  });

  it("re-syncs the baseline without touching the draft", async () => {
    const id = draft("# Mine\n");
    await github.client.commit({
      branch: "main",
      message: "unrelated",
      changes: [{ path: "README.md", content: "hi" }],
    });

    const { baseCommitSha } = await publish.resync(id);

    expect(baseCommitSha).toBe(github.headOf("main"));
    expect(documents.get(id).source).toBe("# Mine\n");
    await expect(publish.publish(id, ADA)).resolves.toMatchObject({
      createdBranch: true,
    });
  });

  it("publishes a draft that has no baseline yet", async () => {
    const id = documents.create(
      {
        collection: "blog",
        path: "src/content/blog/new.md",
        source: "# New\n",
      },
      ADA,
    ).id;

    const result = await publish.publish(id, ADA);

    expect(result.document.publication.baseCommitSha).toBe(
      github.headOf("main"),
    );
    expect(result.createdPullRequest).toBe(true);
  });

  it("moves to published when the pull request merges", async () => {
    const id = draft();
    const { pullRequest } = await publish.publish(id, ADA);
    github.mergePullRequest(pullRequest.number);

    const document = await publish.refresh(id);

    expect(document.status).toBe("published");
  });

  it("falls back to draft when the pull request is closed unmerged", async () => {
    const id = draft();
    await publish.publish(id, ADA);
    github.closeAllPullRequests();

    const document = await publish.refresh(id);

    expect(document.status).toBe("draft");
    expect(document.publication.branch).toBe("cms/blog/hello");
  });

  it("refuses a branch whose pull request is gone", async () => {
    const id = draft();
    await publish.publish(id, ADA);
    github.closeAllPullRequests();
    documents.update(id, { source: "# Again\n" }, ADA);

    expect(await codeOf(() => publish.publish(id, ADA))).toBe("branch_blocked");
  });

  it("reports a missing document", async () => {
    expect(await codeOf(() => publish.publish("missing", ADA))).toBe(
      "not_found",
    );
  });
});
