/**
 * The operations the CMS needs from its one GitHub repository. Services depend
 * on this interface, never on HTTP details: `createHttpGitHubClient` talks to
 * the GitHub REST API, and `createFakeGitHubClient` keeps a repository in
 * memory for tests. All access goes through the API; there is no local clone
 * (docs/adr/0003-github-api-no-clone.md).
 */
export interface GitHubClient {
  /** Repository metadata, whether GitHub reports push access, and token expiry. */
  getRepository(): Promise<RepositoryInfo>;
  /** Commit SHA at the tip of `branch`, or undefined if the branch does not exist. */
  getBranchHead(branch: string): Promise<string | undefined>;
  /** Paths of every file in the tree at `ref`. */
  listFiles(ref: string): Promise<string[]>;
  /** UTF-8 file content at `ref`, or undefined if there is no file at `path`. */
  readFile(path: string, ref: string): Promise<string | undefined>;
  /**
   * Raw file bytes at `ref`, or undefined if there is no file at `path`.
   * For binary content (images) that `readFile`'s UTF-8 decoding would
   * corrupt.
   */
  readBinaryFile(path: string, ref: string): Promise<Buffer | undefined>;
  /** Creates `branch` pointing at `fromSha`. */
  createBranch(branch: string, fromSha: string): Promise<void>;
  /**
   * Commits `changes` on top of the tip of `branch` and moves the branch to
   * the new commit (fast-forward only). This is the "push".
   */
  commit(input: CommitInput): Promise<string>;
  /** The open pull request whose head is `branch`, if any. */
  findOpenPullRequest(branch: string): Promise<PullRequest | undefined>;
  /** Open pull requests, newest first (up to 100). */
  listOpenPullRequests(): Promise<PullRequest[]>;
  getPullRequest(number: number): Promise<PullRequest | undefined>;
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequest>;
}

export interface RepositoryInfo {
  readonly fullName: string;
  /** Web URL of the repository. */
  readonly url: string;
  /** GitHub's `permissions.push` for the token's account on this repository. */
  readonly canPush: boolean;
  /** ISO date when the token expires, if GitHub reports one. */
  readonly tokenExpiresAt: string | null;
}

/** `content: null` deletes the file. */
export interface FileChange {
  readonly path: string;
  readonly content: string | null;
}

export interface CommitInput {
  readonly branch: string;
  readonly message: string;
  readonly changes: readonly FileChange[];
}

export interface PullRequest {
  readonly number: number;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly title: string;
  readonly head: string;
  readonly base: string;
}

export interface CreatePullRequestInput {
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

/** A failed GitHub call. `status` is the HTTP status, or 0 for network errors. */
export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}
