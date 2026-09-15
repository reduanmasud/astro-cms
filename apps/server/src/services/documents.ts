import { randomUUID } from "node:crypto";
import type { DocumentRepository } from "../db/document-repository.ts";
import {
  defaultSlug,
  formatFromPath,
  isDocumentStatus,
  isValidSlug,
  type CmsDocument,
  type CollaboratorRef,
  type DocumentStatus,
  type DocumentSummary,
} from "../documents/model.ts";
import { isSafeRepositoryPath } from "../github/names.ts";

export const MAX_SOURCE_BYTES = 1024 * 1024;
const DEFAULT_PAGE_SIZE = 50;
/** The largest page `list` will return; a full pass has to page with it. */
export const MAX_PAGE_SIZE = 200;
const MAX_SEARCH_LENGTH = 200;

export type DocumentErrorCode =
  "invalid" | "not_found" | "already_exists" | "conflict";

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;
  /** For "conflict": the revision the caller should reload. */
  readonly currentRevision?: number;

  constructor(
    code: DocumentErrorCode,
    message: string,
    currentRevision?: number,
  ) {
    super(message);
    this.name = "DocumentError";
    this.code = code;
    if (currentRevision !== undefined) this.currentRevision = currentRevision;
  }
}

export interface CreateDocumentInput {
  readonly collection: string;
  readonly path: string;
  readonly source?: string;
  readonly slug?: string;
  /** The collection directory, used to derive the default slug. */
  readonly contentPath?: string | null;
  readonly baseCommitSha?: string | null;
}

export interface UpdateDocumentInput {
  readonly source?: string;
  readonly slug?: string;
  readonly status?: DocumentStatus;
  /** When set, the update fails with "conflict" if the document changed since. */
  readonly expectedRevision?: number;
}

export interface ListOptions {
  readonly collection?: string;
  readonly status?: DocumentStatus;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Drafts in SQLite. This service has no GitHub dependency, so creating,
 * editing, or deleting a draft can never change the repository.
 */
export interface DocumentService {
  create(
    input: CreateDocumentInput,
    actor: CollaboratorRef | null,
  ): CmsDocument;
  get(id: string): CmsDocument;
  findByPath(path: string): CmsDocument | undefined;
  list(options?: ListOptions): DocumentSummary[];
  search(text: string, options?: ListOptions): DocumentSummary[];
  update(
    id: string,
    input: UpdateDocumentInput,
    actor: CollaboratorRef | null,
  ): CmsDocument;
  delete(id: string): void;
}

interface Deps {
  repository: DocumentRepository;
  now?: () => number;
  newId?: () => string;
}

export function createDocumentService({
  repository,
  now = Date.now,
  newId = randomUUID,
}: Deps): DocumentService {
  function get(id: string): CmsDocument {
    const document = repository.findById(id);
    if (!document)
      throw new DocumentError("not_found", "No document with that id.");
    return document;
  }

  return {
    create(input, actor) {
      const format = formatFromPath(input.path);
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(input.collection))
        invalid("Invalid collection name.");
      if (!isSafeRepositoryPath(input.path))
        invalid("Invalid repository path.");
      if (format === undefined)
        invalid("Only .md and .mdx files can be drafted.");
      const slug = input.slug ?? defaultSlug(input.path, input.contentPath);
      if (!isValidSlug(slug)) invalid("Invalid slug.");
      const source = input.source ?? "";
      assertSourceSize(source);
      if (repository.findByPath(input.path)) {
        throw new DocumentError(
          "already_exists",
          "A draft for this path already exists.",
        );
      }

      const id = newId();
      repository.insert({
        id,
        collection: input.collection,
        path: input.path,
        format,
        slug,
        source,
        createdBy: actor?.id ?? null,
        createdAt: now(),
        baseCommitSha: input.baseCommitSha ?? null,
      });
      return get(id);
    },

    get,

    findByPath(path) {
      return repository.findByPath(path);
    },

    list(options = {}) {
      return repository.list(query(options));
    },

    search(text, options = {}) {
      const search = text.trim();
      if (search === "" || search.length > MAX_SEARCH_LENGTH) {
        invalid(`Search text must be 1–${MAX_SEARCH_LENGTH} characters.`);
      }
      return repository.list({ ...query(options), search });
    },

    update(id, input, actor) {
      const { source, slug, status, expectedRevision } = input;
      if (source === undefined && slug === undefined && status === undefined) {
        invalid("Nothing to update.");
      }
      if (slug !== undefined && !isValidSlug(slug)) invalid("Invalid slug.");
      if (status !== undefined && !isDocumentStatus(status))
        invalid("Invalid status.");
      if (source !== undefined) assertSourceSize(source);

      const current = get(id);
      const updated = repository.update(
        id,
        {
          source,
          slug,
          status,
          updatedBy: actor?.id ?? null,
          updatedAt: now(),
        },
        expectedRevision,
      );
      if (!updated) {
        const latest = get(id);
        throw new DocumentError(
          "conflict",
          `The document changed since revision ${expectedRevision ?? current.revision}. Reload it and try again.`,
          latest.revision,
        );
      }
      return get(id);
    },

    delete(id) {
      if (!repository.delete(id))
        throw new DocumentError("not_found", "No document with that id.");
    },
  };
}

function query(options: ListOptions) {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    invalid(`limit must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  if (!Number.isInteger(offset) || offset < 0)
    invalid("offset must be 0 or more.");
  if (options.status !== undefined && !isDocumentStatus(options.status))
    invalid("Invalid status.");
  return {
    collection: options.collection,
    status: options.status,
    limit,
    offset,
  };
}

function assertSourceSize(source: string): void {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    invalid(`Source is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB.`);
  }
}

function invalid(message: string): never {
  throw new DocumentError("invalid", message);
}
