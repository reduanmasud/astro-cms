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
