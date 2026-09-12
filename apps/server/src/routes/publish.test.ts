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
      { source: "# Changed\n" },
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
