/** GitHub user or organization name. */
export function isValidOwner(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value);
}

/** GitHub repository name (without the owner). */
export function isValidRepositoryName(value: string): boolean {
  return (
    /^[A-Za-z0-9._-]{1,100}$/.test(value) && value !== "." && value !== ".."
  );
}

/**
 * A conservative subset of Git's branch-name rules: letters, digits, `.`,
 * `_`, `-`, and `/` between non-empty segments, with no `..` or `.lock`.
 */
export function isValidBranchName(value: string): boolean {
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  if (value.includes("..") || value.endsWith(".lock")) return false;
  return value
    .split("/")
    .every((segment) => segment !== "" && !segment.startsWith("."));
}
