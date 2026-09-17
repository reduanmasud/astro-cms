import { randomUUID } from "node:crypto";
import type {
  MediaRecord,
  MediaRepository,
  MediaUsage,
} from "../db/media-repository.ts";
import type { CollaboratorRef } from "../documents/model.ts";
import {
  inspectUpload,
  objectKeyFor,
  MAX_UPLOAD_BYTES,
} from "../media/inspect.ts";
import type { MediaStorage, ObjectHead } from "../media/storage.ts";

/**
 * Media: bytes in object storage, metadata in SQLite
 * (docs/adr/0017-media-storage.md).
 *
 * Uploads are content-addressed, so the same image uploaded twice is stored
 * once and both uploads get the same record. Credentials never leave the
 * storage adapter; callers receive public URLs.
 */

export type MediaErrorCode =
  | "not_configured"
  | "invalid"
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "not_found"
  | "in_use";

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.name = "MediaError";
    this.code = code;
  }
}

/** A media record as the API returns it: metadata plus where to fetch it. */
export interface MediaItem extends MediaRecord {
  readonly url: string;
}

export interface UploadMediaInput {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export interface UploadedMedia {
  readonly media: MediaItem;
  /** False when the same bytes were already stored. */
  readonly created: boolean;
}

export interface ListMediaOptions {
  readonly unusedOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MediaService {
  isEnabled(): boolean;
  upload(
    input: UploadMediaInput,
    actor: CollaboratorRef | null,
  ): Promise<UploadedMedia>;
  get(id: string): MediaItem;
  /** Where a file is used. Throws `not_found` when there is no such file. */
  references(id: string): MediaUsage;
  list(options?: ListMediaOptions): MediaItem[];
  /** Removes the object and its metadata. Refuses while anything still references it. */
  delete(id: string): Promise<void>;
  /** Asks storage whether the object is really there. */
  verify(id: string): Promise<ObjectHead | undefined>;
}

interface Deps {
  repository: MediaRepository;
  storage: MediaStorage | null;
  maxBytes?: number;
  now?: () => number;
  newId?: () => string;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_FILENAME_LENGTH = 200;
/** Objects are immutable, so they can be cached hard. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export function createMediaService({
  repository,
  storage,
  maxBytes = MAX_UPLOAD_BYTES,
  now = Date.now,
  newId = randomUUID,
}: Deps): MediaService {
  function requireStorage(): MediaStorage {
    if (storage === null) {
      throw new MediaError(
        "not_configured",
        "Media storage is not configured on this server.",
      );
    }
    return storage;
  }

  function toItem(record: MediaRecord): MediaItem {
    return { ...record, url: requireStorage().publicUrl(record.objectKey) };
  }

  function find(id: string): MediaRecord {
    const record = repository.findById(id);
    if (!record) throw new MediaError("not_found", "No media with that id.");
    return record;
  }

  return {
    isEnabled: () => storage !== null,

    async upload({ filename, bytes }, actor) {
      const store = requireStorage();
      const name = filename.trim().slice(0, MAX_FILENAME_LENGTH);
      if (name === "")
        throw new MediaError("invalid", "The file needs a name.");

      const inspection = inspectUpload(bytes, maxBytes);
      if (!inspection.ok) {
        throw new MediaError(inspection.error.code, inspection.error.message);
      }
      const file = inspection.file;

      // Same bytes, same object: reuse the record instead of storing twice.
      const existing = repository.findBySha256(file.sha256);
      if (existing) return { media: toItem(existing), created: false };

      const objectKey = objectKeyFor(file.sha256, file.extension);
      await store.upload({
        key: objectKey,
        body: bytes,
        contentType: file.contentType,
        cacheControl: CACHE_CONTROL,
      });

      const id = newId();
      repository.insert({
        id,
        objectKey,
        filename: name,
        contentType: file.contentType,
        size: file.size,
        sha256: file.sha256,
        width: file.width,
        height: file.height,
        uploadedBy: actor?.id ?? null,
        uploadedAt: now(),
      });
      return { media: toItem(find(id)), created: true };
    },

    get(id) {
      return toItem(find(id));
    },

    references(id) {
      // `find` throws not_found, so a bad id cannot come back as "unused" —
      // which is the one answer that would make deletion look safe.
      find(id);
      return repository.findReferences(id);
    },

    list(options = {}) {
      const limit = options.limit ?? DEFAULT_PAGE_SIZE;
      const offset = options.offset ?? 0;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
        throw new MediaError(
          "invalid",
          `limit must be between 1 and ${MAX_PAGE_SIZE}.`,
        );
      }
      if (!Number.isInteger(offset) || offset < 0) {
        throw new MediaError("invalid", "offset must be 0 or more.");
      }
      return repository
        .list({ unusedOnly: options.unusedOnly, limit, offset })
        .map((record) => toItem(record));
    },

    async delete(id) {
      const store = requireStorage();
      const record = find(id);
      if (record.referenceCount > 0) {
        throw new MediaError(
          "in_use",
          `This file is used in ${String(record.referenceCount)} place(s) — drafts, or published content. Remove it from them first.`,
        );
      }
      // Storage first: a leftover row is easier to explain than a dead URL.
      await store.delete(record.objectKey);
      repository.delete(id);
    },

    async verify(id) {
      const store = requireStorage();
      return store.head(find(id).objectKey);
    },
  };
}
