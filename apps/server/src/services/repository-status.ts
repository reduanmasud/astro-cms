import type {
  GitHubClient,
  PullRequest,
  RepositoryInfo,
} from "../github/client.ts";
import { CMS_BRANCH_PREFIX } from "../github/names.ts";
import { explainAccessError } from "./repository-errors.ts";

export type CheckId =
  "access" | "push" | "baseBranch" | "contents" | "astro" | "pullRequests";

export interface RepositoryCheck {
  readonly id: CheckId;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RepositoryStats {
  readonly files: number | null;
  /** Markdown and MDX files under src/. */
  readonly contentFiles: number | null;
  readonly openPullRequests: number | null;
  readonly openCmsPullRequests: number | null;
}

/** A read-only report on the connected repository. */
export interface RepositoryStatus {
  readonly fullName: string;
  readonly url: string;
  readonly baseBranch: string;
  readonly headSha: string | null;
  readonly tokenExpiresAt: string | null;
  readonly checks: readonly RepositoryCheck[];
  readonly stats: RepositoryStats;
}

const ASTRO_CONFIG = /^astro\.config\.(mjs|js|ts|mts|cjs|cts)$/;
const CONTENT_FILE = /^src\/.+\.mdx?$/;

/** The outcome of one GitHub read, so one failure does not hide the other checks. */
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: explainAccessError(error).message };
  }
}

/**
 * Runs read-only checks against the repository and gathers stats. Never
 * throws: every failure becomes a failed check with an explanation.
 */
export async function collectStatus(
  github: GitHubClient,
  baseBranch: string,
  fallbackName: string,
): Promise<RepositoryStatus> {
  const repo = await attempt(() => github.getRepository());
  if (!repo.ok) return unreachableStatus(fallbackName, baseBranch, repo.error);

  const [head, pulls] = await Promise.all([
    attempt(() => github.getBranchHead(baseBranch)),
    attempt(() => github.listOpenPullRequests()),
  ]);
  const headSha = head.ok ? (head.value ?? null) : null;
  const files: Result<string[]> =
    headSha === null
      ? {
          ok: false,
          error: "Skipped because the base branch could not be read.",
        }
      : await attempt(() => github.listFiles(headSha));

  return {
    fullName: repo.value.fullName,
    url: repo.value.url,
    baseBranch,
    headSha,
    tokenExpiresAt: repo.value.tokenExpiresAt,
    checks: [
      accessCheck(repo.value),
      pushCheck(repo.value),
      baseBranchCheck(baseBranch, head, headSha),
      contentsCheck(files),
      astroCheck(files),
      pullRequestsCheck(pulls),
    ],
    stats: buildStats(files, pulls),
  };
}

function accessCheck(repo: RepositoryInfo): RepositoryCheck {
  return {
    id: "access",
    label: "GitHub token accepted",
    ok: true,
    detail: `Connected to ${repo.fullName}.`,
  };
}

function pushCheck(repo: RepositoryInfo): RepositoryCheck {
  return {
    id: "push",
    label: "Push access",
    ok: repo.canPush,
    detail: repo.canPush
      ? "GitHub reports push access for the token's account."
      : "GitHub reports no push access. Give the token write access to Contents and Pull requests.",
  };
}

function baseBranchCheck(
  baseBranch: string,
  head: Result<string | undefined>,
  headSha: string | null,
): RepositoryCheck {
  const detail =
    headSha !== null
      ? `Latest commit ${headSha.slice(0, 7)}.`
      : head.ok
        ? "Branch not found. Check GITHUB_BASE_BRANCH."
        : head.error;
  return {
    id: "baseBranch",
    label: `Base branch "${baseBranch}"`,
    ok: headSha !== null,
    detail,
  };
}

function contentsCheck(files: Result<string[]>): RepositoryCheck {
  return {
    id: "contents",
    label: "Read files",
    ok: files.ok,
    detail: files.ok ? `${files.value.length} files.` : files.error,
  };
}

function astroCheck(files: Result<string[]>): RepositoryCheck {
  const config = files.ok
    ? files.value.find((path) => ASTRO_CONFIG.test(path))
    : undefined;
  const detail = config
    ? `Found ${config}.`
    : files.ok
      ? "No astro.config.* file at the repository root."
      : files.error;
  return {
    id: "astro",
    label: "Astro project",
    ok: config !== undefined,
    detail,
  };
}

function pullRequestsCheck(pulls: Result<PullRequest[]>): RepositoryCheck {
  return {
    id: "pullRequests",
    label: "Read pull requests",
    ok: pulls.ok,
    detail: pulls.ok
      ? `${pulls.value.length} open, ${cmsPullRequests(pulls.value).length} from the CMS.`
      : pulls.error,
  };
}

function buildStats(
  files: Result<string[]>,
  pulls: Result<PullRequest[]>,
): RepositoryStats {
  return {
    files: files.ok ? files.value.length : null,
    contentFiles: files.ok
      ? files.value.filter((path) => CONTENT_FILE.test(path)).length
      : null,
    openPullRequests: pulls.ok ? pulls.value.length : null,
    openCmsPullRequests: pulls.ok ? cmsPullRequests(pulls.value).length : null,
  };
}

function cmsPullRequests(pulls: readonly PullRequest[]): PullRequest[] {
  return pulls.filter((pr) => pr.head.startsWith(CMS_BRANCH_PREFIX));
}

const CHECK_LABELS: Record<CheckId, (baseBranch: string) => string> = {
  access: () => "GitHub token accepted",
  push: () => "Push access",
  baseBranch: (baseBranch) => `Base branch "${baseBranch}"`,
  contents: () => "Read files",
  astro: () => "Astro project",
  pullRequests: () => "Read pull requests",
};

function unreachableStatus(
  fullName: string,
  baseBranch: string,
  error: string,
): RepositoryStatus {
  const ids = Object.keys(CHECK_LABELS) as CheckId[];
  return {
    fullName,
    url: fullName ? `https://github.com/${fullName}` : "",
    baseBranch,
    headSha: null,
    tokenExpiresAt: null,
    checks: ids.map((id) => ({
      id,
      label: CHECK_LABELS[id](baseBranch),
      ok: false,
      detail: id === "access" ? error : "Skipped because GitHub access failed.",
    })),
    stats: {
      files: null,
      contentFiles: null,
      openPullRequests: null,
      openCmsPullRequests: null,
    },
  };
}
