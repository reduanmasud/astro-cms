# Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a SQLite draft as a commit on a `cms/` branch with an open pull request, reusing the same branch and pull request on every later publish.

**Architecture:** A new `services/publish.ts` owns the sequence: drift check → `repository.saveToBranch` → record publication columns. `services/documents.ts` stays SQLite-only and `services/repository.ts` stays GitHub-only; publish is the one place that knows both, so the MCP server can later call it instead of reimplementing it.

**Tech Stack:** Node 24 type stripping (run `.ts` directly, relative imports carry the `.ts` extension), TypeScript 7, Hono 4.13, better-sqlite3 13, Vitest 5, React 19.

**Spec:** `docs/superpowers/specs/2026-09-12-publishing-design.md`

## Global Constraints

- **Drafting never writes to GitHub.** Only `publish` may call a writing repository method.
- **Pull requests only.** No `PUBLISH_MODE=direct`. The CMS never writes the base branch.
- **Drift blocks on any difference** between `document.publication.baseCommitSha` and `repository.getBaseHead()` — not only when this file changed.
- **Branch name is `cms/<collection>/<slug>`.** Never `cms/<slug>` (collides across collections), never per-person.
- **Interfaces, not type aliases,** for object shapes (ESLint `consistent-type-definitions`).
- **Explicit return types** on exported functions (ESLint `explicit-module-boundary-types`).
- **No ORM, no new migration.** The six publication columns already exist.
- **Every task ends green:** `pnpm check` (typecheck, eslint, prettier, vitest) must pass before committing.
- Commit messages: `<type>: <description>` (feat, fix, refactor, docs, test, chore).

---

### Task 1: Let the fake GitHub client merge a pull request

The fake has `closeAllPullRequests()` but no way to mark one merged, so the
"merged pull request moves the draft to published" test cannot be written yet.

**Files:**

- Modify: `apps/server/src/github/fake.ts:21-28` (the `FakeGitHub` interface) and `apps/server/src/github/fake.ts:168-181` (the returned helpers)
- Test: `apps/server/src/github/fake.test.ts` (create)

**Interfaces:**

- Consumes: nothing.
- Produces: `FakeGitHub.mergePullRequest(number: number): void` — sets that pull request's `state` to `"closed"` and `merged` to `true`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/github/fake.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakeGitHubClient } from "./fake.ts";

describe("fake GitHub client", () => {
  it("marks a pull request merged", async () => {
    const github = createFakeGitHubClient();
    await github.client.createBranch(
      "cms/blog/hello",
      github.headOf("main") ?? "",
    );
    const pr = await github.client.createPullRequest({
      head: "cms/blog/hello",
      base: "main",
      title: "CMS: blog/hello",
      body: "",
    });

    github.mergePullRequest(pr.number);

    await expect(
      github.client.getPullRequest(pr.number),
    ).resolves.toMatchObject({
      state: "closed",
      merged: true,
    });
    await expect(
      github.client.findOpenPullRequest("cms/blog/hello"),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @astro-cms/server exec vitest run src/github/fake.test.ts`
Expected: FAIL — `github.mergePullRequest is not a function`.

- [ ] **Step 3: Add the helper**

In `apps/server/src/github/fake.ts`, add to the `FakeGitHub` interface after `closeAllPullRequests(): void;`:

```ts
  /** Marks one pull request merged, as GitHub does when it is merged. */
  mergePullRequest(number: number): void;
```

And add to the returned object after the `closeAllPullRequests` property:

```ts
    mergePullRequest: (number: number) => {
      const index = pullRequests.findIndex((pr) => pr.number === number);
      const pr = pullRequests[index];
      if (pr === undefined) throw new Error(`No pull request ${String(number)}`);
      pullRequests[index] = { ...pr, state: "closed", merged: true };
    },
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @astro-cms/server exec vitest run src/github/fake.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/github/fake.ts apps/server/src/github/fake.test.ts
git commit -m "test: let the fake GitHub client merge a pull request"
```

---

### Task 2: Write the publication columns

`DocumentRepository` reads all six publication columns but nothing writes them.

**Files:**

- Modify: `apps/server/src/db/document-repository.ts` (the `DocumentRepository` interface near line 40, and the returned object after `update`, near line 183)
- Test: `apps/server/src/db/document-repository.test.ts` (exists — append)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `PublicationChanges` — `{ branch: string; pullRequestNumber: number; pullRequestUrl: string; publishedCommitSha: string; publishedAt: number; status: DocumentStatus }`
  - `DocumentRepository.setPublication(id: string, changes: PublicationChanges): void`
  - `DocumentRepository.setBaseCommit(id: string, sha: string): void`
  - `DocumentRepository.setStatus(id: string, status: DocumentStatus): void`

Neither method bumps `revision`: publishing records where a draft went, it does
not change the draft, and bumping would break an editor holding a revision.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/db/document-repository.test.ts`:

```ts
describe("publication", () => {
  it("records a publish without bumping the revision", () => {
    const db = openDatabase(":memory:");
    const repository = createDocumentRepository(db);
    repository.insert({
      id: "d1",
      collection: "blog",
      path: "src/content/blog/hello.md",
      format: "md",
      slug: "hello",
      source: "# Hi\n",
      createdBy: null,
      createdAt: 1000,
      baseCommitSha: "sha0001",
    });

    repository.setPublication("d1", {
      branch: "cms/blog/hello",
      pullRequestNumber: 7,
      pullRequestUrl: "https://github.com/acme/blog/pull/7",
      publishedCommitSha: "sha0002",
      publishedAt: 2000,
      status: "in_review",
    });

    const document = repository.findById("d1");
    expect(document?.revision).toBe(1);
    expect(document?.status).toBe("in_review");
    expect(document?.publication).toEqual({
      baseCommitSha: "sha0001",
      branch: "cms/blog/hello",
      pullRequestNumber: 7,
      pullRequestUrl: "https://github.com/acme/blog/pull/7",
      publishedCommitSha: "sha0002",
      publishedAt: 2000,
    });
  });

  it("moves the baseline and the status on their own", () => {
    const db = openDatabase(":memory:");
    const repository = createDocumentRepository(db);
    repository.insert({
      id: "d1",
      collection: "blog",
      path: "src/content/blog/hello.md",
      format: "md",
      slug: "hello",
      source: "# Hi\n",
      createdBy: null,
      createdAt: 1000,
      baseCommitSha: "sha0001",
    });

    repository.setBaseCommit("d1", "sha0099");
    repository.setStatus("d1", "published");

    const document = repository.findById("d1");
    expect(document?.publication.baseCommitSha).toBe("sha0099");
    expect(document?.status).toBe("published");
    expect(document?.source).toBe("# Hi\n");
    expect(document?.revision).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @astro-cms/server exec vitest run src/db/document-repository.test.ts`
Expected: FAIL — `repository.setPublication is not a function`.

- [ ] **Step 3: Add the interface members**

In `apps/server/src/db/document-repository.ts`, add above `export interface DocumentRepository {`:

```ts
/** What one publish records. Written together, so they are one shape. */
export interface PublicationChanges {
  readonly branch: string;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly publishedCommitSha: string;
  readonly publishedAt: number;
  readonly status: DocumentStatus;
}
```

Add inside `export interface DocumentRepository { ... }`, after `delete(id: string): boolean;`:

```ts
  /** Records one publish. Does not bump `revision`: the draft did not change. */
  setPublication(id: string, changes: PublicationChanges): void;
  /** Moves the drift baseline (docs/adr/0005-drift-detection.md). */
  setBaseCommit(id: string, sha: string): void;
  setStatus(id: string, status: DocumentStatus): void;
```

`DocumentStatus` is already imported at the top of this file.

- [ ] **Step 4: Implement the three methods**

In the object returned by `createDocumentRepository`, after the `delete(id)` property:

```ts
    setPublication(id, changes) {
      db.prepare(
        `UPDATE documents
            SET branch = ?, pull_request_number = ?, pull_request_url = ?,
                published_commit_sha = ?, published_at = ?, status = ?
          WHERE id = ?`,
      ).run(
        changes.branch,
        changes.pullRequestNumber,
        changes.pullRequestUrl,
        changes.publishedCommitSha,
        changes.publishedAt,
        changes.status,
        id,
      );
    },

    setBaseCommit(id, sha) {
      db.prepare("UPDATE documents SET base_commit_sha = ? WHERE id = ?").run(
        sha,
        id,
      );
    },

    setStatus(id, status) {
      db.prepare("UPDATE documents SET status = ? WHERE id = ?").run(
        status,
        id,
      );
    },
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @astro-cms/server exec vitest run src/db/document-repository.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db/document-repository.ts apps/server/src/db/document-repository.test.ts
git commit -m "feat: write the document publication columns"
```

---

### Task 3: The publish service

**Files:**

- Create: `apps/server/src/services/publish.ts`
- Test: `apps/server/src/services/publish.test.ts` (create)

**Interfaces:**

- Consumes: `DocumentRepository.setPublication`, `.setBaseCommit`, `.setStatus` (Task 2); `FakeGitHub.mergePullRequest` (Task 1); existing `RepositoryService.getBaseHead()`, `.readFile(path, ref?)`, `.saveToBranch(input)`, `.getPullRequest(number)`; existing `DocumentService.get(id)`.
- Produces:
  - `PublishErrorCode` = `"drift" | "not_found" | "branch_blocked" | "invalid"`
  - `class PublishError extends Error { readonly code: PublishErrorCode; readonly drift?: DriftReport }`
  - `interface DriftReport { drifted: boolean; baseCommitSha: string | null; headSha: string; baseContent: string | null }`
  - `interface PublishResult { pullRequest: PullRequest; commitSha: string; createdBranch: boolean; createdPullRequest: boolean; document: CmsDocument }`
  - `interface PublishService { publish(id, actor): Promise<PublishResult>; drift(id): Promise<DriftReport>; resync(id): Promise<{ baseCommitSha: string }>; refresh(id): Promise<CmsDocument>; branchFor(document): string }`
  - `createPublishService(deps: { documents; repository; documentRepository; now?: () => number }): PublishService`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/services/publish.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @astro-cms/server exec vitest run src/services/publish.test.ts`
Expected: FAIL — `Failed to resolve import "./publish.ts"`.

- [ ] **Step 3: Write the service**

Create `apps/server/src/services/publish.ts`:

```ts
import type {
  DocumentRepository,
  PublicationChanges,
} from "../db/document-repository.ts";
import type { CmsDocument, CollaboratorRef } from "../documents/model.ts";
import type { PullRequest } from "../github/client.ts";
import { CMS_BRANCH_PREFIX } from "../github/names.ts";
import { DocumentError, type DocumentService } from "./documents.ts";
import { RepositoryError, type RepositoryService } from "./repository.ts";

/**
 * Publishing: a draft becomes a commit on its own `cms/` branch with an open
 * pull request (docs/adr/0004-one-branch-per-content-item.md). Drafting never
 * reaches GitHub; this service is the only one that writes there.
 */

export type PublishErrorCode =
  "drift" | "not_found" | "branch_blocked" | "invalid";

export class PublishError extends Error {
  readonly code: PublishErrorCode;
  /** Present when `code` is "drift", so the caller can show the difference. */
  readonly drift?: DriftReport;

  constructor(code: PublishErrorCode, message: string, drift?: DriftReport) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    if (drift !== undefined) this.drift = drift;
  }
}

export interface DriftReport {
  readonly drifted: boolean;
  readonly baseCommitSha: string | null;
  readonly headSha: string;
  /** The file as it stands on the base branch, or null if it is not there. */
  readonly baseContent: string | null;
}

export interface PublishResult {
  readonly pullRequest: PullRequest;
  readonly commitSha: string;
  readonly createdBranch: boolean;
  readonly createdPullRequest: boolean;
  readonly document: CmsDocument;
}

export interface PublishService {
  publish(id: string, actor: CollaboratorRef | null): Promise<PublishResult>;
  /** Compares the draft's baseline with the base branch head. */
  drift(id: string): Promise<DriftReport>;
  /** Adopts the current base head as the draft's baseline. */
  resync(id: string): Promise<{ baseCommitSha: string }>;
  /** Asks GitHub about this draft's pull request and updates its status. */
  refresh(id: string): Promise<CmsDocument>;
  branchFor(document: CmsDocument): string;
}

interface Deps {
  documents: DocumentService;
  documentRepository: DocumentRepository;
  repository: RepositoryService;
  now?: () => number;
}

export function createPublishService({
  documents,
  documentRepository,
  repository,
  now = Date.now,
}: Deps): PublishService {
  function get(id: string): CmsDocument {
    try {
      return documents.get(id);
    } catch (error) {
      if (error instanceof DocumentError && error.code === "not_found") {
        throw new PublishError("not_found", "No document with that id.");
      }
      throw error;
    }
  }

  /** `cms/<collection>/<slug>`: one branch per content item, never per person. */
  function branchFor(document: CmsDocument): string {
    return `${CMS_BRANCH_PREFIX}${document.collection}/${document.slug}`;
  }

  async function report(document: CmsDocument): Promise<DriftReport> {
    const headSha = await repository.getBaseHead();
    const baseCommitSha = document.publication.baseCommitSha;
    return {
      // A draft with no baseline has nothing to violate.
      drifted: baseCommitSha !== null && baseCommitSha !== headSha,
      baseCommitSha,
      headSha,
      baseContent: (await repository.readFile(document.path)) ?? null,
    };
  }

  return {
    branchFor,

    async publish(id, actor) {
      const document = get(id);
      const drift = await report(document);
      if (drift.drifted) {
        throw new PublishError(
          "drift",
          `${document.path} cannot be published: the base branch moved since this draft started. Re-sync it, then publish again.`,
          drift,
        );
      }

      const branch = branchFor(document);
      const existed = document.publication.branch !== null;
      let saved;
      try {
        saved = await repository.saveToBranch({
          branch,
          message: `${existed ? "Update" : "Add"} ${document.path}`,
          changes: [{ path: document.path, content: document.source }],
          pullRequest: {
            title: `CMS: ${document.collection}/${document.slug}`,
            body: [
              `Published from Astro CMS by ${actor?.name ?? "someone"}.`,
              "",
              `- File: \`${document.path}\``,
              `- Collection: ${document.collection}`,
              "",
              "The CMS manages this branch; it commits here on every publish.",
            ].join("\n"),
          },
        });
      } catch (error) {
        if (error instanceof RepositoryError) {
          throw new PublishError("branch_blocked", error.message);
        }
        throw error;
      }

      const changes: PublicationChanges = {
        branch,
        pullRequestNumber: saved.pullRequest.number,
        pullRequestUrl: saved.pullRequest.url,
        publishedCommitSha: saved.commitSha,
        publishedAt: now(),
        status: "in_review",
      };
      documentRepository.setPublication(id, changes);
      if (drift.baseCommitSha === null) {
        documentRepository.setBaseCommit(id, drift.headSha);
      }

      return {
        pullRequest: saved.pullRequest,
        commitSha: saved.commitSha,
        createdBranch: saved.createdBranch,
        createdPullRequest: saved.createdPullRequest,
        document: get(id),
      };
    },

    drift(id) {
      return report(get(id));
    },

    async resync(id) {
      get(id);
      const headSha = await repository.getBaseHead();
      documentRepository.setBaseCommit(id, headSha);
      return { baseCommitSha: headSha };
    },

    async refresh(id) {
      const document = get(id);
      const number = document.publication.pullRequestNumber;
      if (number === null) return document;

      const pullRequest = await repository.getPullRequest(number);
      if (pullRequest === undefined) return document;
      if (pullRequest.merged) documentRepository.setStatus(id, "published");
      else if (pullRequest.state === "closed")
        documentRepository.setStatus(id, "draft");
      return get(id);
    },
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @astro-cms/server exec vitest run src/services/publish.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the whole check**

Run: `pnpm check`
Expected: typecheck, eslint, prettier, and every test suite pass. If prettier
complains, run `pnpm exec prettier --write apps/server/src/services/publish.ts apps/server/src/services/publish.test.ts` and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/publish.ts apps/server/src/services/publish.test.ts
git commit -m "feat: publish a draft to a cms branch and pull request"
```

---

### Task 4: The publish routes

**Files:**

- Modify: `apps/server/src/routes/documents.ts` (add to `Deps`, add three routes, add `publishErrorResponse`)
- Modify: `apps/server/src/app.ts:24-37` (`AppDeps`), `:55-68` (destructuring), `:88` (route wiring), `:93-102` (`onError`)
- Modify: `apps/server/src/test-support/app.ts` (build and pass the service)
- Modify: `apps/server/src/index.ts` (build and pass the service)
- Test: `apps/server/src/routes/publish.test.ts` (create)

**Interfaces:**

- Consumes: `createPublishService`, `PublishError`, `PublishService` (Task 3).
- Produces: `publishErrorResponse(c: Context, error: PublishError): Response`; routes `POST /api/documents/:id/publish`, `GET /api/documents/:id/drift`, `POST /api/documents/:id/resync`; `TestApp.github` already exposed for assertions.

- [ ] **Step 1: Write the failing route tests**

Create `apps/server/src/routes/publish.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  requestJson,
  signIn,
  type TestApp,
} from "../test-support/app.ts";

interface PublishBody {
  pullRequest?: { number: number; url: string; base: string };
  commitSha?: string;
  createdBranch?: boolean;
  document?: { status: string; publication: Record<string, unknown> };
  error?: {
    code: string;
    message: string;
    drift?: { baseContent: string | null };
  };
}

describe("publish API", () => {
  let harness: TestApp;
  let cookie: string;
  let documentId: string;

  beforeEach(async () => {
    harness = buildTestApp();
    cookie = await signIn(harness.app, "Ada");
    const created = (await (
      await requestJson(harness.app, cookie, "POST", "/api/documents", {
        collection: "blog",
        path: "src/content/blog/hello.md",
      })
    ).json()) as { document: { id: string } };
    documentId = created.document.id;
  });

  it("publishes a draft and returns its pull request", async () => {
    const response = await requestJson(
      harness.app,
      cookie,
      "POST",
      `/api/documents/${documentId}/publish`,
    );
    const body = (await response.json()) as PublishBody;

    expect(response.status).toBe(200);
    expect(body.createdBranch).toBe(true);
    expect(body.pullRequest?.base).toBe("main");
    expect(body.document?.status).toBe("in_review");
    expect(harness.github.branchNames()).toContain("cms/blog/hello");
  });

  it("publishing twice reuses the pull request", async () => {
    await requestJson(
      harness.app,
      cookie,
      "POST",
      `/api/documents/${documentId}/publish`,
    );
    await requestJson(
      harness.app,
      cookie,
      "PATCH",
      `/api/documents/${documentId}`,
      {
        source: "# Changed\n",
      },
    );

    await requestJson(
      harness.app,
      cookie,
      "POST",
      `/api/documents/${documentId}/publish`,
    );

    expect(harness.github.pullRequestCount()).toBe(1);
  });

  it("answers 409 with the base content when the base branch moved", async () => {
    await harness.github.client.commit({
      branch: "main",
      message: "someone else",
      changes: [{ path: "src/content/blog/hello.md", content: "# Theirs\n" }],
    });

    const response = await requestJson(
      harness.app,
      cookie,
      "POST",
      `/api/documents/${documentId}/publish`,
    );
    const body = (await response.json()) as PublishBody;

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("drift");
    expect(body.error?.drift?.baseContent).toBe("# Theirs\n");
    expect(harness.github.pullRequestCount()).toBe(0);
  });

  it("reports drift and then re-syncs", async () => {
    await harness.github.client.commit({
      branch: "main",
      message: "someone else",
      changes: [{ path: "README.md", content: "hi" }],
    });

    const before = (await (
      await requestJson(
        harness.app,
        cookie,
        "GET",
        `/api/documents/${documentId}/drift`,
      )
    ).json()) as { drifted: boolean };
    expect(before.drifted).toBe(true);

    await requestJson(
      harness.app,
      cookie,
      "POST",
      `/api/documents/${documentId}/resync`,
    );

    const after = (await (
      await requestJson(
        harness.app,
        cookie,
        "GET",
        `/api/documents/${documentId}/drift`,
      )
    ).json()) as { drifted: boolean };
    expect(after.drifted).toBe(false);
  });

  it("refreshes status from the pull request", async () => {
    const published = (await (
      await requestJson(
        harness.app,
        cookie,
        "POST",
        `/api/documents/${documentId}/publish`,
      )
    ).json()) as PublishBody;
    harness.github.mergePullRequest(published.pullRequest?.number ?? 0);

    const body = (await (
      await requestJson(
        harness.app,
        cookie,
        "GET",
        `/api/documents/${documentId}?refresh=true`,
      )
    ).json()) as { document: { status: string } };

    expect(body.document.status).toBe("published");
  });

  it("requires a display name", async () => {
    const app = buildTestApp();
    const nameless = await signIn(app.app);

    const response = await requestJson(
      app.app,
      nameless,
      "POST",
      `/api/documents/${documentId}/publish`,
    );

    expect(response.status).toBe(403);
  });

  it("requires a session", async () => {
    const response = await harness.app.request(
      `/api/documents/${documentId}/publish`,
      { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } },
    );

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @astro-cms/server exec vitest run src/routes/publish.test.ts`
Expected: FAIL — the publish route answers 404 `not_found`.

- [ ] **Step 3: Add the routes**

In `apps/server/src/routes/documents.ts`, add to the imports:

```ts
import {
  PublishError,
  type PublishErrorCode,
  type PublishService,
} from "../services/publish.ts";
```

Add `publish: PublishService;` to `interface Deps`, and destructure `publish`
in `documentRoutes({ documents, drafts, collab, publish })`.

Replace the existing `routes.get("/:id", ...)` with a version that can refresh:

```ts
routes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const document =
    new URL(c.req.url).searchParams.get("refresh") === "true"
      ? await publish.refresh(id)
      : documents.get(id);
  return c.json({ document });
});
```

Add these three routes after it:

```ts
routes.post("/:id/publish", withName, async (c) =>
  c.json(await publish.publish(c.req.param("id"), c.var.session.collaborator)),
);

routes.get("/:id/drift", async (c) =>
  c.json(await publish.drift(c.req.param("id"))),
);

routes.post("/:id/resync", withName, async (c) =>
  c.json(await publish.resync(c.req.param("id"))),
);
```

Add at the end of the file, beside `documentErrorResponse`:

```ts
/** Maps a PublishError to its HTTP status and body. */
export function publishErrorResponse(
  c: Context,
  error: PublishError,
): Response {
  const statuses: Record<PublishErrorCode, ContentfulStatusCode> = {
    drift: 409,
    branch_blocked: 409,
    not_found: 404,
    invalid: 400,
  };
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.drift === undefined ? {} : { drift: error.drift }),
      },
    },
    statuses[error.code],
  );
}
```

- [ ] **Step 4: Wire the service into the app**

In `apps/server/src/app.ts`: add `import { PublishError, type PublishService } from "./services/publish.ts";`, add `publish: PublishService;` to `AppDeps`, add `publish` to the `createApp` destructuring, change the documents route to
`app.route("/api/documents", documentRoutes({ documents, drafts, collab, publish }));`,
add `publishErrorResponse` to the import from `./routes/documents.ts`, and add
this line to `onError` directly after the `DocumentError` line:

```ts
if (error instanceof PublishError) return publishErrorResponse(c, error);
```

In `apps/server/src/test-support/app.ts`: import `createPublishService` from
`../services/publish.ts`, and build it after `documents` is created:

```ts
const documentRepository = createDocumentRepository(db);
const documents = createDocumentService({ repository: documentRepository });
const publish = createPublishService({
  documents,
  documentRepository,
  repository,
});
```

(The existing line builds the repository inline; replace it with the two lines
above so both services share one `documentRepository`.) Pass `publish` in the
`createApp({ ... })` call.

In `apps/server/src/index.ts`: make the same change — hold
`const documentRepository = createDocumentRepository(db);`, pass it to
`createDocumentService`, build `createPublishService({ documents, documentRepository, repository })`,
and pass `publish` to `createApp`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @astro-cms/server exec vitest run src/routes/publish.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the whole check**

Run: `pnpm check`
Expected: everything passes. Fix formatting with `pnpm exec prettier --write <files>` if needed.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src
git commit -m "feat: publish, drift, and resync API routes"
```

---

### Task 5: Publish from the editor

**Files:**

- Modify: `apps/web/src/api.ts` (add the three calls near the Drafts section)
- Modify: `apps/web/src/editor/DocumentEditor.tsx` (a Publish button and a conflict panel)
- Test: `apps/web/src/api.test.ts` (append)

**Interfaces:**

- Consumes: the routes from Task 4.
- Produces: `publishDocument(id)`, `getDrift(id)`, `resyncDocument(id)` in `apps/web/src/api.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/api.test.ts` (and add `publishDocument`, `getDrift`, `resyncDocument` to the existing import from `./api.ts`):

```ts
describe("publishDocument", () => {
  it("posts to the publish route", async () => {
    const fetchMock = mockFetch(200, {
      pullRequest: { number: 3, url: "https://github.com/acme/blog/pull/3" },
      commitSha: "sha0002",
      createdBranch: true,
      createdPullRequest: true,
    });

    await expect(publishDocument("d1")).resolves.toMatchObject({
      createdBranch: true,
    });
    const { path, init } = lastRequest(fetchMock);
    expect(path).toBe("/api/documents/d1/publish");
    expect(init?.method).toBe("POST");
  });

  it("surfaces drift as an ApiError carrying the conflict", async () => {
    mockFetch(409, {
      error: {
        code: "drift",
        message: "the base branch moved",
        drift: { drifted: true, baseContent: "# Theirs\n" },
      },
    });

    const error = await publishDocument("d1").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "drift" });
  });
});

describe("getDrift and resyncDocument", () => {
  it("reads and then clears drift", async () => {
    const readMock = mockFetch(200, {
      drifted: true,
      baseCommitSha: "sha0001",
      headSha: "sha0009",
      baseContent: "# Theirs\n",
    });
    await expect(getDrift("d1")).resolves.toMatchObject({ drifted: true });
    expect(lastRequest(readMock).path).toBe("/api/documents/d1/drift");

    const resyncMock = mockFetch(200, { baseCommitSha: "sha0009" });
    await expect(resyncDocument("d1")).resolves.toEqual({
      baseCommitSha: "sha0009",
    });
    expect(lastRequest(resyncMock).init?.method).toBe("POST");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @astro-cms/web exec vitest run src/api.test.ts`
Expected: FAIL — `publishDocument is not a function`.

- [ ] **Step 3: Add the API calls**

In `apps/web/src/api.ts`, after `deleteDocument`, add:

```ts
// --- Publishing --------------------------------------------------------------

export interface PublishedPullRequest {
  number: number;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  title: string;
  head: string;
  base: string;
}

export interface PublishResult {
  pullRequest: PublishedPullRequest;
  commitSha: string;
  createdBranch: boolean;
  createdPullRequest: boolean;
  document: CmsDocument;
}

export interface DriftReport {
  drifted: boolean;
  baseCommitSha: string | null;
  headSha: string;
  baseContent: string | null;
}

/** Commits the draft to its CMS branch and opens or updates its pull request. */
export function publishDocument(id: string): Promise<PublishResult> {
  return request(`/api/documents/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}

export function getDrift(id: string): Promise<DriftReport> {
  return request(`/api/documents/${encodeURIComponent(id)}/drift`);
}

/** Adopts the current base branch commit as the draft's baseline. */
export function resyncDocument(id: string): Promise<{ baseCommitSha: string }> {
  return request(`/api/documents/${encodeURIComponent(id)}/resync`, {
    method: "POST",
  });
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm --filter @astro-cms/web exec vitest run src/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Publish button and conflict panel**

In `apps/web/src/editor/DocumentEditor.tsx`, extend the import from `../api.ts`
with `getDrift`, `publishDocument`, `resyncDocument`, and `type DriftReport`.

Add state beside the existing `useState` calls:

```tsx
const [publishing, setPublishing] = useState(false);
const [published, setPublished] = useState<string | null>(null);
const [conflict, setConflict] = useState<DriftReport | null>(null);
```

Add this handler beside `updateFrontmatter`:

```tsx
async function publish(): Promise<void> {
  setPublishing(true);
  setError(undefined);
  try {
    // Save first: publishing a stale draft would publish something the
    // person is not looking at.
    await autosave.saveNow();
    const result = await publishDocument(documentId);
    setConflict(null);
    setPublished(result.pullRequest.url);
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === "drift") {
      setConflict(await getDrift(documentId));
    } else {
      setError(caught instanceof Error ? caught.message : "Publishing failed.");
    }
  } finally {
    setPublishing(false);
  }
}

async function resync(): Promise<void> {
  await resyncDocument(documentId);
  setConflict(null);
}
```

Add the button to the header, after the existing "Save now" button:

```tsx
<button type="button" onClick={() => void publish()} disabled={publishing}>
  {publishing ? "Publishing…" : "Publish"}
</button>
```

Add this directly above `<Toolbar editor={editor} />`:

```tsx
{
  published !== null && (
    <p className="hint">
      Published.{" "}
      <a href={published} target="_blank" rel="noreferrer">
        Open the pull request
      </a>
    </p>
  );
}
{
  conflict !== null && (
    <section className="conflict" role="alert">
      <h2>The base branch moved</h2>
      <p>
        This file changed on the repository since the draft started, so
        publishing stopped. Nothing was written to GitHub.
      </p>
      <pre>
        {conflict.baseContent ?? "(the file is not on the base branch)"}
      </pre>
      <button type="button" onClick={() => void resync()}>
        Re-sync and keep my draft
      </button>
    </section>
  );
}
```

- [ ] **Step 6: Run the whole check**

Run: `pnpm check`
Expected: everything passes. React Compiler rules are enforced here: do not
call `setState` in an effect body, and read refs only in handlers.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat: publish a draft from the editor"
```

---

### Task 6: Document it

**Files:**

- Create: `docs/adr/0019-publishing-through-pull-requests.md`
- Modify: `docs/adr/README.md` (append the index row)
- Modify: `README.md` (a Publishing section)
- Modify: `docs/architecture.md` (the API table)

- [ ] **Step 1: Write ADR-0019**

Create `docs/adr/0019-publishing-through-pull-requests.md` recording: pull
requests only (the CMS never writes the base branch); `cms/<collection>/<slug>`
rather than the PRD's `cms/<person>/<id>`, because a per-person branch splits
one file across two pull requests; status refreshed on demand rather than by
polling or webhooks; drift blocking on any base-branch movement with an
explicit re-sync that never merges text. Use the format of the existing ADRs:
Context, Decision, Alternatives Considered, Consequences (Positive, Negative,
Risks). Record the lingering-branch consequence: after a merge, GitHub's
"automatically delete head branches" setting keeps the next publish working.

- [ ] **Step 2: Add the index row**

Append to `docs/adr/README.md`:

```markdown
| [0019](0019-publishing-through-pull-requests.md) | Publishing through pull requests on one branch per item | accepted | 2026-09-12 |
```

- [ ] **Step 3: Document publishing in the README**

Add a "Publishing" section after the Media section: publishing commits the
draft to `cms/<collection>/<slug>` and opens a pull request; publishing again
updates the same branch and pull request; the CMS never writes the base branch
and never merges; if the base branch moved, publishing stops and offers a
re-sync; enable "automatically delete head branches" on the repository so a
merged branch does not block the next publish.

- [ ] **Step 4: Add the routes to the architecture doc**

Add to the API table in `docs/architecture.md`:

```markdown
| `POST /api/documents/:id/publish` | Commit the draft to its CMS branch and open or update its pull request |
| `GET /api/documents/:id/drift` | Whether the base branch moved, with its version of the file |
| `POST /api/documents/:id/resync` | Adopt the current base commit as the draft's baseline |
```

- [ ] **Step 5: Run the whole check**

Run: `pnpm check`
Expected: passes, including `prettier --check` over the docs.

- [ ] **Step 6: Commit**

```bash
git add docs README.md
git commit -m "docs: record how publishing works"
```

---

### Task 7: Publish once against the real repository

The fake proves the logic; only GitHub proves the integration. Publishing
opens a pull request and never merges, so this is safe to run against the
configured repository.

**Files:** none — this is a verification task.

- [ ] **Step 1: Start the server against the real repository**

Use a scratch data directory and a port that is free, borrowing the real
`GITHUB_*` values from `.env` without modifying it:

```bash
cd /Users/reduanmasud/Documents/Projects/miscellaneous/astro-cms
set -a; . ./.env; set +a
PORT=3100 DATA_DIR=/tmp/publish-probe CMS_PASSWORD=probe-password \
SESSION_SECRET=probe-secret-that-is-long-enough-0123456789 \
node apps/server/src/index.ts
```

- [ ] **Step 2: Sign in, create a draft, and publish it**

```bash
curl -s -c /tmp/pc.txt -X POST localhost:3100/api/session \
  -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: same-origin' \
  -d '{"password":"probe-password"}'
curl -s -b /tmp/pc.txt -c /tmp/pc.txt -X PUT localhost:3100/api/session/display-name \
  -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: same-origin' \
  -d '{"name":"Probe"}'
curl -s -b /tmp/pc.txt -X POST localhost:3100/api/documents \
  -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: same-origin' \
  -d '{"collection":"blog","path":"src/content/blog/cms-publish-probe.md"}'
# then, with the id from that response:
curl -s -b /tmp/pc.txt -X POST -H 'Sec-Fetch-Site: same-origin' \
  localhost:3100/api/documents/<id>/publish
```

Expected: a JSON body with a real pull request number and URL.

- [ ] **Step 3: Check GitHub**

```bash
gh pr list --repo reduanmasud/astro-portfolio --head cms/blog/cms-publish-probe
```

Expected: one open pull request, whose diff adds
`src/content/blog/cms-publish-probe.md`.

- [ ] **Step 4: Publish again and confirm no second pull request**

Change the draft with `PATCH /api/documents/<id>`, publish again, and re-run
the `gh pr list` command. Expected: still exactly one pull request, now with
two commits.

- [ ] **Step 5: Close the probe pull request and stop the server**

```bash
gh pr close <number> --repo reduanmasud/astro-portfolio --delete-branch
```

Report the pull request URL and both `gh pr list` outputs. Do not merge.
