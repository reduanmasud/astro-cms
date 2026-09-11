import {
  GitHubError,
  type GitHubClient,
  type PullRequest,
  type RepositoryInfo,
} from "./client.ts";

interface Options {
  token: string;
  owner: string;
  repository: string;
  /** Injected in tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  apiUrl?: string;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;

const API_VERSION = "2022-11-28";
const DEFAULT_TIMEOUT_MS = 15_000;
const FILE_MODE = "100644";

/** GitHubClient backed by the GitHub REST API. The token never leaves this module. */
export function createHttpGitHubClient({
  token,
  owner,
  repository,
  fetch: fetchImpl = fetch,
  apiUrl = "https://api.github.com",
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: Options): GitHubClient {
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;

  async function send(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await fetchImpl(`${apiUrl}${repoPath}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": "astro-cms",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new GitHubError(0, `GitHub ${method} ${path} failed: ${reason}`);
    }
  }

  /** Sends a request and returns the JSON body; throws GitHubError on any non-2xx status. */
  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    return (await requestWithHeaders(method, path, body)).data;
  }

  async function requestWithHeaders(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: unknown; headers: Headers }> {
    const response = await send(method, path, body);
    const data: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        isJson(data) && typeof data.message === "string" ? data.message : "";
      throw new GitHubError(
        response.status,
        `GitHub ${method} ${path} failed (${response.status})${message ? `: ${message}` : ""}`,
      );
    }
    return { data, headers: response.headers };
  }

  /** Like `request`, but a 404 becomes undefined. */
  async function requestOptional(path: string): Promise<unknown> {
    try {
      return await request("GET", path);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404)
        return undefined;
      throw error;
    }
  }

  async function getBranchHead(branch: string): Promise<string | undefined> {
    const data = await requestOptional(`/git/ref/heads/${encodePath(branch)}`);
    return data === undefined
      ? undefined
      : text(record(asJson(data), "object"), "sha");
  }

  return {
    async getRepository(): Promise<RepositoryInfo> {
      const { data: body, headers } = await requestWithHeaders("GET", "");
      const data = asJson(body);
      const permissions = isJson(data.permissions) ? data.permissions : {};
      return {
        fullName: text(data, "full_name"),
        url: text(data, "html_url"),
        canPush: permissions.push === true,
        tokenExpiresAt: parseExpiry(
          headers.get("github-authentication-token-expiration"),
        ),
      };
    },

    getBranchHead,

    async listFiles(ref) {
      const data = asJson(
        await request(
          "GET",
          `/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        ),
      );
      if (data.truncated === true) {
        throw new GitHubError(
          0,
          "Repository tree is too large to list in one request.",
        );
      }
      return list(data, "tree")
        .filter((entry) => entry.type === "blob")
        .map((entry) => text(entry, "path"));
    },

    async readFile(path, ref) {
      const query = new URLSearchParams({ ref });
      const data = await requestOptional(
        `/contents/${encodePath(path)}?${query.toString()}`,
      );
      if (!isJson(data) || data.type !== "file") return undefined;

      // The contents API omits content for files over 1 MB; fetch the blob instead.
      if (data.encoding === "none") {
        const blob = asJson(
          await request("GET", `/git/blobs/${text(data, "sha")}`),
        );
        return decodeBase64(text(blob, "content"));
      }
      return decodeBase64(text(data, "content"));
    },

    async createBranch(branch, fromSha) {
      await request("POST", "/git/refs", {
        ref: `refs/heads/${branch}`,
        sha: fromSha,
      });
    },

    async commit({ branch, message, changes }) {
      const head = await getBranchHead(branch);
      if (head === undefined) {
        throw new GitHubError(404, `Branch "${branch}" does not exist.`);
      }
      const parent = asJson(await request("GET", `/git/commits/${head}`));

      const tree = asJson(
        await request("POST", "/git/trees", {
          base_tree: text(record(parent, "tree"), "sha"),
          tree: changes.map(({ path, content }) =>
            content === null
              ? { path, mode: FILE_MODE, type: "blob", sha: null }
              : { path, mode: FILE_MODE, type: "blob", content },
          ),
        }),
      );
      const commit = asJson(
        await request("POST", "/git/commits", {
          message,
          tree: text(tree, "sha"),
          parents: [head],
        }),
      );
      const sha = text(commit, "sha");

      // force: false makes GitHub reject the update if the branch moved meanwhile.
      await request("PATCH", `/git/refs/heads/${encodePath(branch)}`, {
        sha,
        force: false,
      });
      return sha;
    },

    async findOpenPullRequest(branch) {
      const query = new URLSearchParams({
        state: "open",
        head: `${owner}:${branch}`,
      });
      const data = await request("GET", `/pulls?${query.toString()}`);
      const first = Array.isArray(data) ? (data[0] as unknown) : undefined;
      return first === undefined ? undefined : toPullRequest(first);
    },

    async listOpenPullRequests() {
      const data = await request("GET", "/pulls?state=open&per_page=100");
      if (!Array.isArray(data)) throw unexpected("pulls");
      return data.map(toPullRequest);
    },

    async getPullRequest(number) {
      const data = await requestOptional(`/pulls/${number}`);
      return data === undefined ? undefined : toPullRequest(data);
    },

    async createPullRequest(input) {
      return toPullRequest(await request("POST", "/pulls", input));
    },
  };
}

function toPullRequest(value: unknown): PullRequest {
  const data = asJson(value);
  return {
    number: numeric(data, "number"),
    url: text(data, "html_url"),
    state: data.state === "open" ? "open" : "closed",
    merged: typeof data.merged_at === "string",
    title: text(data, "title"),
    head: text(record(data, "head"), "ref"),
    base: text(record(data, "base"), "ref"),
  };
}

/** GitHub sends e.g. "2026-12-31 00:00:00 UTC"; returns ISO 8601, or null. */
function parseExpiry(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64(content: string): string {
  return Buffer.from(content, "base64").toString("utf8");
}

// Minimal runtime checks: GitHub responses are external input.

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpected(key: string): GitHubError {
  return new GitHubError(
    0,
    `Unexpected response from GitHub: missing "${key}".`,
  );
}

function asJson(value: unknown): Json {
  if (!isJson(value)) throw unexpected("body");
  return value;
}

function record(data: Json, key: string): Json {
  const value = data[key];
  if (!isJson(value)) throw unexpected(key);
  return value;
}

function list(data: Json, key: string): Json[] {
  const value = data[key];
  if (!Array.isArray(value)) throw unexpected(key);
  return value.filter(isJson);
}

function text(data: Json, key: string): string {
  const value = data[key];
  if (typeof value !== "string") throw unexpected(key);
  return value;
}

function numeric(data: Json, key: string): number {
  const value = data[key];
  if (typeof value !== "number") throw unexpected(key);
  return value;
}
