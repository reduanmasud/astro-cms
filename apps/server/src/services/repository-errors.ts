import { GitHubError } from "../github/client.ts";

/** A CMS rule was broken, or the repository is not usable as configured. */
export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

/** Turns a failed access check into an explanation an operator can act on. */
export function explainAccessError(error: unknown): Error {
  if (!(error instanceof GitHubError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
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
        "Repository not found or not visible to GITHUB_TOKEN (404). Check " +
          "GITHUB_OWNER and GITHUB_REPOSITORY are correct, and that the " +
          "token was granted access to that repository. If GITHUB_OWNER is " +
          'an organization: a fine-grained token\'s "Resource owner" must ' +
          "be set to that organization, not your personal account — a " +
          "personal-account token cannot see organization repositories at " +
          "all, and GitHub reports that the same way as a repository that " +
          "does not exist.",
      );
    default:
      return new RepositoryError(
        `Could not reach the GitHub repository: ${error.message}`,
      );
  }
}
