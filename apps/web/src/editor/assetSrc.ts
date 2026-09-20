/**
 * What the editor actually displays for an image's `src` — never what gets
 * saved. A path already in the document (root-relative, content-relative,
 * or a bare filename) means nothing to this app's own origin, so the
 * browser can't fetch it directly; this resolves it against the
 * repository and routes it through /api/repo-asset instead. An absolute
 * URL (including our own S3 media) is already fetchable and passes
 * through unchanged.
 */
export function resolveAssetSrc(src: string, documentPath: string): string {
  if (isAbsolute(src)) return src;
  const repoPath = src.startsWith("/")
    ? normalize(src.slice(1))
    : normalize(`${dirname(documentPath)}/${src}`);
  return `/api/repo-asset?path=${encodeURIComponent(repoPath)}`;
}

function isAbsolute(src: string): boolean {
  return (
    src.startsWith("data:") ||
    src.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(src)
  );
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Resolves "." and ".." segments; never escapes above the repository root. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}
