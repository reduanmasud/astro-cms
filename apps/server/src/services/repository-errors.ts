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
        "Repository not found or not visible to GITHUB_TOKEN (404). Check GITHUB_OWNER, GITHUB_REPOSITORY, and the token's repository access.",
      );
    default:
      return new RepositoryError(
        `Could not reach the GitHub repository: ${error.message}`,
      );
  }
}
