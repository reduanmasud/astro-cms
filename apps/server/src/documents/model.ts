/**
 * The CMS document model: one draft of one content file. Drafts live only in
 * SQLite; publishing (a later phase) fills in the publication fields.
 */

export type DocumentFormat = "md" | "mdx";

/** draft: being edited. in_review: a pull request is open. published: merged. */
export type DocumentStatus = "draft" | "in_review" | "published";

export const DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  "draft",
  "in_review",
  "published",
];

export interface CollaboratorRef {
  readonly id: string;
  readonly name: string;
}

export interface Publication {
  /** Base-branch commit the draft started from (docs/adr/0005-drift-detection.md). */
  readonly baseCommitSha: string | null;
  readonly branch: string | null;
  readonly pullRequestNumber: number | null;
  readonly pullRequestUrl: string | null;
  readonly publishedCommitSha: string | null;
  readonly publishedAt: number | null;
}

/** A document without its content, for lists. */
export interface DocumentSummary {
  readonly id: string;
  readonly collection: string;
  /** Repository path of the file, e.g. src/content/blog/hello.md. */
  readonly path: string;
  readonly format: DocumentFormat;
  readonly slug: string;
  readonly status: DocumentStatus;
  /** Increases on every update; used to reject writes based on a stale copy. */
  readonly revision: number;
  readonly createdBy: CollaboratorRef | null;
  readonly updatedBy: CollaboratorRef | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly publication: Publication;
}

export interface CmsDocument extends DocumentSummary {
  /** The whole file: frontmatter and body, exactly as it will be written. */
  readonly source: string;
}

const MAX_SLUG_LENGTH = 200;

export function formatFromPath(path: string): DocumentFormat | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension === "md" || extension === "mdx" ? extension : undefined;
}

/**
 * Astro-style id: the path inside the collection directory without its
 * extension, e.g. "nested/world" for src/content/blog/nested/world.mdx.
 */
export function defaultSlug(path: string, contentPath?: string | null): string {
  const prefix = contentPath && contentPath !== "." ? `${contentPath}/` : "";
  const relative =
    prefix && path.startsWith(prefix)
      ? path.slice(prefix.length)
      : (path.split("/").pop() ?? path);
  return relative.replace(/\.[A-Za-z0-9]+$/, "").toLowerCase();
}

/** Lowercase segments of letters, digits, `.`, `_`, `-`, separated by `/`. */
export function isValidSlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug.length <= MAX_SLUG_LENGTH &&
    /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(slug)
  );
}

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return (
    typeof value === "string" &&
    (DOCUMENT_STATUSES as readonly string[]).includes(value)
  );
}
