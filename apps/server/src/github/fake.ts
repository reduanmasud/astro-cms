import { GitHubError, type GitHubClient, type PullRequest } from "./client.ts";

interface Commit {
  readonly parent: string | null;
  readonly files: ReadonlyMap<string, string>;
}

export interface FakeOptions {
  /** Files on the base branch. */
  files?: Record<string, string>;
  baseBranch?: string;
  canPush?: boolean;
  /** Make every call fail with this HTTP status. */
  failWith?: number;
}

/** The fake client plus helpers for inspecting its state in assertions. */
export interface FakeGitHub {
  readonly client: GitHubClient;
  headOf(branch: string): string | undefined;
  parentOf(sha: string): string | null | undefined;
  pullRequestCount(): number;
  closeAllPullRequests(): void;
}

/**
 * An in-memory GitHub repository for tests. It behaves like the real API for
 * the operations the CMS uses, and exposes a few helpers to inspect state.
 */
export function createFakeGitHubClient({
  files = {},
  baseBranch = "main",
  canPush = true,
  failWith,
}: FakeOptions = {}): FakeGitHub {
  const commits = new Map<string, Commit>();
  const branches = new Map<string, string>();
  const pullRequests: PullRequest[] = [];
  let nextSha = 1;

  function addCommit(commit: Commit): string {
    const sha = `sha${String(nextSha++).padStart(4, "0")}`;
    commits.set(sha, commit);
    return sha;
  }

  branches.set(
    baseBranch,
    addCommit({ parent: null, files: new Map(Object.entries(files)) }),
  );

  function guard(): void {
    if (failWith !== undefined)
      throw new GitHubError(failWith, `Fake GitHub error ${failWith}`);
  }

  function filesAt(ref: string): ReadonlyMap<string, string> | undefined {
    const sha = branches.get(ref) ?? ref;
    return commits.get(sha)?.files;
  }

  const client: GitHubClient = {
    getRepository() {
      guard();
      return Promise.resolve({ fullName: "acme/blog", canPush });
    },

    getBranchHead(branch) {
      guard();
      return Promise.resolve(branches.get(branch));
    },

    listFiles(ref) {
      guard();
      const tree = filesAt(ref);
      if (!tree)
        return Promise.reject(new GitHubError(404, `No ref "${ref}".`));
      return Promise.resolve([...tree.keys()]);
    },

    readFile(path, ref) {
      guard();
      return Promise.resolve(filesAt(ref)?.get(path));
    },

    createBranch(branch, fromSha) {
      guard();
      if (branches.has(branch)) {
        return Promise.reject(new GitHubError(422, "Reference already exists"));
      }
      branches.set(branch, fromSha);
      return Promise.resolve();
    },

    commit({ branch, changes }) {
      guard();
      const head = branches.get(branch);
      const parent = head === undefined ? undefined : commits.get(head);
      if (head === undefined || parent === undefined) {
        return Promise.reject(
          new GitHubError(404, `Branch "${branch}" does not exist.`),
        );
      }

      const next = new Map(parent.files);
      for (const { path, content } of changes) {
        if (content === null) next.delete(path);
        else next.set(path, content);
      }
      const sha = addCommit({ parent: head, files: next });
      branches.set(branch, sha);
      return Promise.resolve(sha);
    },

    findOpenPullRequest(branch) {
      guard();
      return Promise.resolve(
        pullRequests.find((pr) => pr.head === branch && pr.state === "open"),
      );
    },

    getPullRequest(number) {
      guard();
      return Promise.resolve(pullRequests.find((pr) => pr.number === number));
    },

    createPullRequest({ head, base, title }) {
      guard();
      const number = pullRequests.length + 1;
      const pr: PullRequest = {
        number,
        url: `https://github.com/acme/blog/pull/${number}`,
        state: "open",
        merged: false,
        title,
        head,
        base,
      };
      pullRequests.push(pr);
      return Promise.resolve(pr);
    },
  };

  return {
    client,
    headOf: (branch: string) => branches.get(branch),
    parentOf: (sha: string) => commits.get(sha)?.parent,
    pullRequestCount: () => pullRequests.length,
    closeAllPullRequests: () => {
      pullRequests.splice(
        0,
        pullRequests.length,
        ...pullRequests.map((pr) => ({ ...pr, state: "closed" as const })),
      );
    },
  };
}
