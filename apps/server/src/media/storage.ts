/**
 * Object storage for media binaries. The CMS depends on this interface, never
 * on the S3 SDK: `createS3Storage` talks to an S3-compatible service and
 * `createFakeStorage` keeps objects in memory for tests
 * (docs/adr/0017-media-storage.md).
 *
 * Credentials live only behind this interface. The browser gets public URLs.
 */

export interface ObjectHead {
  readonly contentType: string;
  readonly size: number;
  /** The service's entity tag, when it sends one. */
  readonly etag?: string;
  readonly lastModified?: Date;
}

export interface UploadInput {
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  /** Cache-Control for the stored object. */
  readonly cacheControl?: string;
}

export interface MediaStorage {
  upload(input: UploadInput): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Size and type of the stored object, or undefined when it is missing. */
  head(key: string): Promise<ObjectHead | undefined>;
  /** The URL a browser can fetch this object from. */
  publicUrl(key: string): string;
}

/** A failed storage call. `status` is the HTTP status, or 0 for network errors. */
export class StorageError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StorageError";
    this.status = status;
  }
}
