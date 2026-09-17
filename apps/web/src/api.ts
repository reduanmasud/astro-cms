export interface Collaborator {
  id: string;
  name: string;
}

/** `collaborator` is null until a display name has been chosen. */
export interface Session {
  collaborator: Collaborator | null;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  const body = (await response.json().catch(() => undefined)) as
    ErrorBody | undefined;
  throw new ApiError(
    response.status,
    body?.error?.code ?? "http_error",
    body?.error?.message ?? `Request failed (${response.status}).`,
  );
}

function sendJson(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Returns the current session, or undefined when signed out. */
export async function getSession(): Promise<Session | undefined> {
  try {
    return await request<Session>("/api/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return undefined;
    throw error;
  }
}

export function login(password: string): Promise<Session> {
  return request<Session>("/api/session", sendJson("POST", { password }));
}

export async function chooseDisplayName(name: string): Promise<Collaborator> {
  const { collaborator } = await request<{ collaborator: Collaborator }>(
    "/api/session/display-name",
    sendJson("PUT", { name }),
  );
  return collaborator;
}

export interface RepositoryCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface RepositoryStatus {
  fullName: string;
  url: string;
  baseBranch: string;
  headSha: string | null;
  tokenExpiresAt: string | null;
  checks: RepositoryCheck[];
  stats: {
    files: number | null;
    contentFiles: number | null;
    openPullRequests: number | null;
    openCmsPullRequests: number | null;
  };
}

export function getRepositoryStatus(): Promise<RepositoryStatus> {
  return request<RepositoryStatus>("/api/repository");
}

export function logout(): Promise<void> {
  return request<void>("/api/session", { method: "DELETE" });
}

// --- Astro collections -------------------------------------------------------

export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
  values?: unknown[];
  items?: { type: string };
  fields?: SchemaField[];
  collection?: string;
  nullable?: true;
  format?: string;
}

export interface CollectionSummary {
  name: string;
  loader: string;
  contentPath: string | null;
  pattern: string | null;
  formats: string[];
  entryCount: number | null;
  schema:
    | { inferred: true; fields: SchemaField[] }
    | { inferred: false; reason: string };
}

export interface AstroProjectInfo {
  isAstroProject: boolean;
  astroConfigPath: string | null;
  astroVersion: string | null;
  contentConfigPath: string | null;
  collections: CollectionSummary[];
  warnings: string[];
}

export interface CollectionEntry {
  path: string;
  format: string;
}

export function getCollections(): Promise<AstroProjectInfo> {
  return request<AstroProjectInfo>("/api/collections");
}

export function getCollection(
  name: string,
): Promise<{ collection: CollectionSummary; entries: CollectionEntry[] }> {
  return request(`/api/collections/${encodeURIComponent(name)}`);
}

// --- Drafts ------------------------------------------------------------------

export type DocumentStatus = "draft" | "in_review" | "published";

export interface DocumentSummary {
  id: string;
  collection: string;
  path: string;
  format: "md" | "mdx";
  slug: string;
  status: DocumentStatus;
  revision: number;
  createdBy: Collaborator | null;
  updatedBy: Collaborator | null;
  createdAt: number;
  updatedAt: number;
}

export interface CmsDocument extends DocumentSummary {
  source: string;
}

export function listDocuments(
  params: {
    collection?: string;
    q?: string;
  } = {},
): Promise<{ documents: DocumentSummary[] }> {
  const query = new URLSearchParams();
  if (params.collection) query.set("collection", params.collection);
  if (params.q) query.set("q", params.q);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return request(`/api/documents${suffix}`);
}

/** Opens (or creates) the draft for a repository path. */
export function openDocument(
  collection: string,
  path: string,
): Promise<{ document: CmsDocument; created: boolean }> {
  return request("/api/documents", sendJson("POST", { collection, path }));
}

export function getDocument(id: string): Promise<{ document: CmsDocument }> {
  return request(`/api/documents/${encodeURIComponent(id)}`);
}

export function saveDocument(
  id: string,
  changes: {
    source?: string;
    slug?: string;
    status?: DocumentStatus;
    expectedRevision?: number;
  },
): Promise<{ document: CmsDocument }> {
  return request(
    `/api/documents/${encodeURIComponent(id)}`,
    sendJson("PATCH", changes),
  );
}

export function deleteDocument(id: string): Promise<void> {
  return request(`/api/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// --- Media -------------------------------------------------------------------

export interface MediaItem {
  id: string;
  objectKey: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  url: string;
  referenceCount: number;
  unusedSince: number | null;
  uploadedBy: Collaborator | null;
  uploadedAt: number;
}

/**
 * Stores a file and returns where it now lives. `created` is false when the
 * same bytes were already stored (docs/adr/0017-media-storage.md).
 *
 * The body is FormData on purpose: the browser sets the multipart boundary,
 * which a Content-Type of ours would break.
 */
export function uploadMedia(
  file: File,
): Promise<{ media: MediaItem; created: boolean }> {
  const body = new FormData();
  body.append("file", file);
  return request("/api/media", { method: "POST", body });
}

export interface DraftReference {
  documentId: string;
  collection: string;
  path: string;
}

export interface RepoReference {
  ref: string;
  path: string;
}

export interface MediaUsage {
  drafts: DraftReference[];
  git: RepoReference[];
}

export interface ListMediaOptions {
  /** Only files nothing references — no draft, no branch. */
  unused?: boolean;
  limit?: number;
  offset?: number;
}

export function listMedia(
  options: ListMediaOptions = {},
): Promise<{ media: MediaItem[] }> {
  const query = new URLSearchParams();
  // Only `unused=true` means anything to the server; omit it otherwise
  // rather than sending `unused=false`, which reads as a different filter.
  if (options.unused === true) query.set("unused", "true");
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  // `toString()`, not `.size`: the latter is newer than this project's DOM lib.
  const suffix = query.toString();
  return request(`/api/media${suffix === "" ? "" : `?${suffix}`}`);
}

export function getMediaReferences(
  id: string,
): Promise<{ references: MediaUsage }> {
  return request(`/api/media/${encodeURIComponent(id)}/references`);
}

export function deleteMedia(id: string): Promise<void> {
  return request(`/api/media/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Publishing --------------------------------------------------------------

export interface PublishedPullRequest {
  number: number;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  title: string;
  head: string;
  base: string;
}

export interface PublishResult {
  pullRequest: PublishedPullRequest;
  commitSha: string;
  createdBranch: boolean;
  createdPullRequest: boolean;
  document: CmsDocument;
}

export interface DriftReport {
  drifted: boolean;
  baseCommitSha: string | null;
  headSha: string;
  /** The file as it stands on the base branch, or null if it is not there. */
  baseContent: string | null;
}

/** Commits the draft to its CMS branch and opens or updates its pull request. */
export function publishDocument(id: string): Promise<PublishResult> {
  return request(`/api/documents/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}

export function getDrift(id: string): Promise<DriftReport> {
  return request(`/api/documents/${encodeURIComponent(id)}/drift`);
}

/** Adopts the current base branch commit as the draft's baseline. */
export function resyncDocument(id: string): Promise<{ baseCommitSha: string }> {
  return request(`/api/documents/${encodeURIComponent(id)}/resync`, {
    method: "POST",
  });
}

// --- Live collaboration ------------------------------------------------------

export interface CollabConnection {
  url: string;
  room: string;
  token: string;
  expiresAt: number;
}

/**
 * A short-lived token for this draft's collaboration room. Resolves to
 * undefined when the server has no HocusPocus configured.
 */
export async function getCollabConnection(
  documentId: string,
): Promise<CollabConnection | undefined> {
  try {
    return await request<CollabConnection>(
      `/api/documents/${encodeURIComponent(documentId)}/collaboration`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}
