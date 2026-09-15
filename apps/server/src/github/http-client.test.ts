import { describe, expect, it } from "vitest";
import { GitHubError } from "./client.ts";
import { createHttpGitHubClient } from "./http-client.ts";

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

const REPO = "/repos/acme/blog";

/** A fetch stand-in: replies are keyed by "METHOD /path?query". Unknown routes return 404. */
function mockGitHub(replies: Record<string, Reply>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname + url.search;
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, headers: new Headers(init?.headers) });

    const reply = replies[`${method} ${path}`] ?? {
      status: 404,
      body: { message: "Not Found" },
    };
    return Promise.resolve(
      new Response(
        reply.body === undefined ? null : JSON.stringify(reply.body),
        {
          status: reply.status,
          headers: reply.headers,
        },
      ),
    );
  };
  const client = createHttpGitHubClient({
    token: "ghp_secret",
    owner: "acme",
    repository: "blog",
    fetch: fetchImpl,
  });
  return { client, calls };
}

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("HTTP GitHub client", () => {
  it("sends the token and API version headers", async () => {
    const { client, calls } = mockGitHub({
      [`GET ${REPO}`]: {
        status: 200,
        body: {
          full_name: "acme/blog",
          html_url: "https://github.com/acme/blog",
          permissions: { push: true },
        },
      },
    });

    await client.getRepository();

    const headers = calls[0]?.headers;
    expect(headers?.get("Authorization")).toBe("Bearer ghp_secret");
    expect(headers?.get("Accept")).toBe("application/vnd.github+json");
    expect(headers?.get("X-GitHub-Api-Version")).toBe("2022-11-28");
  });

  describe("getRepository", () => {
    it("reports the URL, push access, and token expiry", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}`]: {
          status: 200,
          body: {
            full_name: "acme/blog",
            html_url: "https://github.com/acme/blog",
            permissions: { push: false },
          },
          headers: {
            "github-authentication-token-expiration": "2026-12-31 00:00:00 UTC",
          },
        },
      });

      await expect(client.getRepository()).resolves.toEqual({
        fullName: "acme/blog",
        url: "https://github.com/acme/blog",
        canPush: false,
        tokenExpiresAt: "2026-12-31T00:00:00.000Z",
      });
    });

    it("reports no expiry when GitHub sends none", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}`]: {
          status: 200,
          body: {
            full_name: "acme/blog",
            html_url: "https://github.com/acme/blog",
          },
        },
      });

      await expect(client.getRepository()).resolves.toMatchObject({
        canPush: false,
        tokenExpiresAt: null,
      });
    });

    it("throws a GitHubError with the status on failure", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}`]: { status: 401, body: { message: "Bad credentials" } },
      });

      const error = await client.getRepository().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(GitHubError);
      expect(error).toMatchObject({ status: 401 });
      expect((error as Error).message).toContain("Bad credentials");
    });

    it("rejects a response without the expected fields", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}`]: { status: 200, body: {} },
      });

      await expect(client.getRepository()).rejects.toThrow(
        /unexpected response/i,
      );
    });
  });

  describe("getBranchHead", () => {
    it("returns the commit SHA and encodes each branch segment", async () => {
      const { client, calls } = mockGitHub({
        [`GET ${REPO}/git/ref/heads/cms/blog%20post`]: {
          status: 200,
          body: { object: { sha: "abc123" } },
        },
      });

      await expect(client.getBranchHead("cms/blog post")).resolves.toBe(
        "abc123",
      );
      expect(calls[0]?.path).toBe(`${REPO}/git/ref/heads/cms/blog%20post`);
    });

    it("returns undefined for a missing branch", async () => {
      const { client } = mockGitHub({});

      await expect(client.getBranchHead("nope")).resolves.toBeUndefined();
    });
  });

  describe("listFiles", () => {
    it("returns only file paths from the recursive tree", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/git/trees/main?recursive=1`]: {
          status: 200,
          body: {
            truncated: false,
            tree: [
              { path: "src", type: "tree" },
              { path: "src/content/hello.md", type: "blob" },
              { path: "astro.config.mjs", type: "blob" },
            ],
          },
        },
      });

      await expect(client.listFiles("main")).resolves.toEqual([
        "src/content/hello.md",
        "astro.config.mjs",
      ]);
    });

    it("refuses a truncated tree instead of returning a partial list", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/git/trees/main?recursive=1`]: {
          status: 200,
          body: { truncated: true, tree: [] },
        },
      });

      await expect(client.listFiles("main")).rejects.toThrow(/too large/);
    });
  });

  describe("readFile", () => {
    it("decodes base64 content", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/contents/src/content/hello.md?ref=main`]: {
          status: 200,
          body: {
            type: "file",
            encoding: "base64",
            content: base64("# Héllo\n"),
          },
        },
      });

      await expect(
        client.readFile("src/content/hello.md", "main"),
      ).resolves.toBe("# Héllo\n");
    });

    it("falls back to the blob API for files over 1 MB", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/contents/big.md?ref=main`]: {
          status: 200,
          body: { type: "file", encoding: "none", content: "", sha: "blob1" },
        },
        [`GET ${REPO}/git/blobs/blob1`]: {
          status: 200,
          body: { encoding: "base64", content: base64("big") },
        },
      });

      await expect(client.readFile("big.md", "main")).resolves.toBe("big");
    });

    it("returns undefined for a missing file or a directory", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/contents/src?ref=main`]: { status: 200, body: [] },
      });

      await expect(
        client.readFile("missing.md", "main"),
      ).resolves.toBeUndefined();
      await expect(client.readFile("src", "main")).resolves.toBeUndefined();
    });
  });

  it("createBranch posts a full ref name", async () => {
    const { client, calls } = mockGitHub({
      [`POST ${REPO}/git/refs`]: { status: 201, body: {} },
    });

    await client.createBranch("cms/hello", "abc123");

    expect(calls[0]?.body).toEqual({
      ref: "refs/heads/cms/hello",
      sha: "abc123",
    });
  });

  describe("commit", () => {
    const replies: Record<string, Reply> = {
      [`GET ${REPO}/git/ref/heads/cms/hello`]: {
        status: 200,
        body: { object: { sha: "head1" } },
      },
      [`GET ${REPO}/git/commits/head1`]: {
        status: 200,
        body: { tree: { sha: "tree1" } },
      },
      [`POST ${REPO}/git/trees`]: { status: 201, body: { sha: "tree2" } },
      [`POST ${REPO}/git/commits`]: { status: 201, body: { sha: "commit2" } },
      [`PATCH ${REPO}/git/refs/heads/cms/hello`]: { status: 200, body: {} },
    };

    it("creates a tree and commit on the branch tip, then fast-forwards the branch", async () => {
      const { client, calls } = mockGitHub(replies);

      const sha = await client.commit({
        branch: "cms/hello",
        message: "Update hello",
        changes: [
          { path: "src/content/hello.md", content: "# Hi\n" },
          { path: "src/content/old.md", content: null },
        ],
      });

      expect(sha).toBe("commit2");
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(
        Object.keys(replies),
      );
      expect(calls[2]?.body).toEqual({
        base_tree: "tree1",
        tree: [
          {
            path: "src/content/hello.md",
            mode: "100644",
            type: "blob",
            content: "# Hi\n",
          },
          {
            path: "src/content/old.md",
            mode: "100644",
            type: "blob",
            sha: null,
          },
        ],
      });
      expect(calls[3]?.body).toEqual({
        message: "Update hello",
        tree: "tree2",
        parents: ["head1"],
      });
      expect(calls[4]?.body).toEqual({ sha: "commit2", force: false });
    });

    it("fails when the branch does not exist", async () => {
      const { client } = mockGitHub({});

      await expect(
        client.commit({ branch: "cms/missing", message: "x", changes: [] }),
      ).rejects.toThrow(/does not exist/);
    });
  });

  describe("pull requests", () => {
    const pull = {
      number: 7,
      html_url: "https://github.com/acme/blog/pull/7",
      state: "open",
      merged_at: null,
      title: "Update hello",
      head: { ref: "cms/hello" },
      base: { ref: "main" },
    };
    const expected = {
      number: 7,
      url: "https://github.com/acme/blog/pull/7",
      state: "open",
      merged: false,
      title: "Update hello",
      head: "cms/hello",
      base: "main",
    };

    it("finds the open pull request for a branch", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/pulls?state=open&head=acme%3Acms%2Fhello`]: {
          status: 200,
          body: [pull],
        },
      });

      await expect(client.findOpenPullRequest("cms/hello")).resolves.toEqual(
        expected,
      );
    });

    it("returns undefined when there is no open pull request", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/pulls?state=open&head=acme%3Acms%2Fhello`]: {
          status: 200,
          body: [],
        },
      });

      await expect(
        client.findOpenPullRequest("cms/hello"),
      ).resolves.toBeUndefined();
    });

    it("lists open pull requests", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/pulls?state=open&per_page=100&page=1`]: {
          status: 200,
          body: [pull, { ...pull, number: 8 }],
        },
      });

      const pulls = await client.listOpenPullRequests();

      expect(pulls.map((pr) => pr.number)).toEqual([7, 8]);
      expect(pulls[0]).toEqual(expected);
    });

    it("keeps paging past a full page of open pull requests", async () => {
      // A caller treats a branch missing from this list as merged, so the
      // 101st open pull request must not fall off the end.
      const page = (from: number, count: number) =>
        Array.from({ length: count }, (_, index) => ({
          ...pull,
          number: from + index,
        }));
      const { client, calls } = mockGitHub({
        [`GET ${REPO}/pulls?state=open&per_page=100&page=1`]: {
          status: 200,
          body: page(1, 100),
        },
        [`GET ${REPO}/pulls?state=open&per_page=100&page=2`]: {
          status: 200,
          body: page(101, 3),
        },
      });

      const pulls = await client.listOpenPullRequests();

      expect(pulls).toHaveLength(103);
      expect(pulls.at(-1)?.number).toBe(103);
      expect(calls).toHaveLength(2);
    });

    it("reads a pull request by number and reports merges", async () => {
      const { client } = mockGitHub({
        [`GET ${REPO}/pulls/7`]: {
          status: 200,
          body: { ...pull, state: "closed", merged_at: "2026-09-11T00:00:00Z" },
        },
      });

      await expect(client.getPullRequest(7)).resolves.toEqual({
        ...expected,
        state: "closed",
        merged: true,
      });
      await expect(client.getPullRequest(8)).resolves.toBeUndefined();
    });

    it("creates a pull request", async () => {
      const { client, calls } = mockGitHub({
        [`POST ${REPO}/pulls`]: { status: 201, body: pull },
      });

      const created = await client.createPullRequest({
        head: "cms/hello",
        base: "main",
        title: "Update hello",
        body: "From Astro CMS",
      });

      expect(created).toEqual(expected);
      expect(calls[0]?.body).toEqual({
        head: "cms/hello",
        base: "main",
        title: "Update hello",
        body: "From Astro CMS",
      });
    });
  });

  it("wraps network failures in a GitHubError with status 0", async () => {
    const client = createHttpGitHubClient({
      token: "t",
      owner: "acme",
      repository: "blog",
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    await expect(client.getRepository()).rejects.toMatchObject({
      name: "GitHubError",
      status: 0,
    });
  });
});
