import {
  GitHubError,
  type FileChange,
  type GitHubClient,
  type PullRequest,
} from "../github/client.ts";
import { isValidBranchName } from "../github/names.ts";

/** Every branch the CMS writes to starts with this (docs/adr/0004-one-branch-per-content-item.md). */
export const CMS_BRANCH_PREFIX = "cms/";

export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

export interface RepositoryAccess {
  readonly fullName: string;
  readonly baseBranch: string;
  readonly headSha: string;
}

export interface SaveToBranchInput {
  readonly branch: string;
  readonly message: string;
  readonly changes: readonly FileChange[];
  /** Used only when the branch has no pull request yet. */
  readonly pullRequest: { readonly title: string; readonly body: string };
}

export interface SaveToBranchResult {
  readonly commitSha: string;
  readonly pullRequest: PullRequest;
  readonly createdBranch: boolean;
  readonly createdPullRequest: boolean;
}

export interface RepositoryService {
  /** Checks the token, push permission, and base branch. Call once at startup. */
  verifyAccess(): Promise<RepositoryAccess>;
  /** Current commit SHA of the base branch. */
  getBaseHead(): Promise<string>;
  /** File paths at `ref` (default: the base branch). */
  listFiles(ref?: string): Promise<string[]>;
  /** File content at `ref` (default: the base branch), or undefined. */
  readFile(path: string, ref?: string): Promise<string | undefined>;
  /**
   * Commits `changes` to a `cms/` branch and makes sure it has an open pull
   * request: creates the branch from the base head and the pull request when
   * missing, otherwise adds a commit to the existing branch and PR.
   */
  saveToBranch(input: SaveToBranchInput): Promise<SaveToBranchResult>;
  getPullRequest(number: number): Promise<PullRequest | undefined>;
}

interface Deps {
  github: GitHubClient;
  baseBranch: string;
}

/**
 * The CMS's view of its one repository. Enforces the rules the GitHub client
 * does not know about: the base branch is read-only, writes go to `cms/`
 * branches only, and paths must stay inside the repository.
 */
export function createRepositoryService({
  github,
  baseBranch,
}: Deps): RepositoryService {
  async function getBaseHead(): Promise<string> {
    const head = await github.getBranchHead(baseBranch);
    if (head === undefined) {
      throw new RepositoryError(`Base branch "${baseBranch}" does not exist.`);
    }
    return head;
  }

  return {
    async verifyAccess() {
      try {
        const repository = await github.getRepository();
        if (!repository.canPush) {
          throw new RepositoryError(
            `GITHUB_TOKEN can read but cannot push to ${repository.fullName}. Grant it write access to contents and pull requests.`,
          );
        }
        return {
          fullName: repository.fullName,
          baseBranch,
          headSha: await getBaseHead(),
        };
      } catch (error) {
        throw explainAccessError(error);
      }
    },

    getBaseHead,

    listFiles(ref = baseBranch) {
      return github.listFiles(ref);
    },

    async readFile(path, ref = baseBranch) {
      assertSafePath(path);
      return github.readFile(path, ref);
    },

    async saveToBranch({ branch, message, changes, pullRequest }) {
      assertCmsBranch(branch, baseBranch);
      if (changes.length === 0)
        throw new RepositoryError("No changes to commit.");
      changes.forEach(({ path }) => assertSafePath(path));

      const existingHead = await github.getBranchHead(branch);
      const existingPr = existingHead
        ? await github.findOpenPullRequest(branch)
        : undefined;
      if (existingHead !== undefined && existingPr === undefined) {
        // Its PR was merged or closed; committing more would reopen old history.
        throw new RepositoryError(
          `Branch "${branch}" exists but has no open pull request. Delete the branch on GitHub to publish again.`,
        );
      }

      if (existingHead === undefined) {
        await github.createBranch(branch, await getBaseHead());
      }
      const commitSha = await github.commit({ branch, message, changes });
      const pr =
        existingPr ??
        (await github.createPullRequest({
          head: branch,
          base: baseBranch,
          ...pullRequest,
        }));

      return {
        commitSha,
        pullRequest: pr,
        createdBranch: existingHead === undefined,
        createdPullRequest: existingPr === undefined,
      };
    },

    getPullRequest(number) {
      return github.getPullRequest(number);
    },
  };
}

function assertCmsBranch(branch: string, baseBranch: string): void {
  const valid =
    branch.startsWith(CMS_BRANCH_PREFIX) &&
    branch.length > CMS_BRANCH_PREFIX.length &&
    branch !== baseBranch &&
    isValidBranchName(branch);
  if (!valid) {
    throw new RepositoryError(
      `Refusing to write to branch "${branch}": the CMS only writes to valid "${CMS_BRANCH_PREFIX}" branches.`,
    );
  }
}

/** Repository-relative paths only: no leading slash, backslashes, or `.`/`..` segments. */
function assertSafePath(path: string): void {
  const safe =
    path !== "" &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path
      .split("/")
      .every(
        (segment) => segment !== "" && segment !== "." && segment !== "..",
      );
  if (!safe) throw new RepositoryError(`Invalid repository path: "${path}".`);
}

function explainAccessError(error: unknown): Error {
  if (!(error instanceof GitHubError))
    return error instanceof Error ? error : new Error(String(error));
  switch (error.status) {
    case 401:
      return new RepositoryError(
        "GITHUB_TOKEN was rejected by GitHub (401). Check that it is valid and not expired.",
      );
    case 403:
      return new RepositoryError(
        `GITHUB_TOKEN is not allowed to access the repository (403): ${error.message}`,
      );
    case 404:
      return new RepositoryError(
        "Repository not found or not visible to GITHUB_TOKEN (404). Check GITHUB_OWNER, GITHUB_REPOSITORY, and the token's repository access.",
      );
    default:
      return new RepositoryError(
        `Could not reach the GitHub repository: ${error.message}`,
      );
  }
}
