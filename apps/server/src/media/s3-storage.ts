import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageConfig } from "../config.ts";
import {
  StorageError,
  type MediaStorage,
  type ObjectHead,
  type UploadInput,
} from "./storage.ts";

/**
 * MediaStorage backed by any S3-compatible service (AWS S3, Cloudflare R2,
 * MinIO). Path-style addressing keeps MinIO and R2 working without DNS setup.
 *
 * The access key and secret stay in this module; callers only ever see keys
 * and public URLs.
 */
export function createS3Storage(
  config: StorageConfig,
  client?: S3Client,
): MediaStorage {
  const s3 =
    client ??
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });

  async function send<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw asStorageError(what, error);
    }
  }

  return {
    async upload({ key, body, contentType, cacheControl }: UploadInput) {
      await send(`upload ${key}`, () =>
        s3.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentLength: body.byteLength,
            ...(cacheControl === undefined
              ? {}
              : { CacheControl: cacheControl }),
          }),
        ),
      );
    },

    async delete(key) {
      await send(`delete ${key}`, () =>
        s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })),
      );
    },

    async exists(key) {
      return (await this.head(key)) !== undefined;
    },

    async head(key) {
      try {
        const response = await s3.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return {
          contentType: response.ContentType ?? "application/octet-stream",
          size: response.ContentLength ?? 0,
          ...(response.ETag === undefined
            ? {}
            : { etag: response.ETag.replaceAll('"', "") }),
          ...(response.LastModified === undefined
            ? {}
            : { lastModified: response.LastModified }),
        } satisfies ObjectHead;
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw asStorageError(`head ${key}`, error);
      }
    },

    publicUrl(key) {
      return `${config.publicUrl}/${key}`;
    },
  };
}

function isNotFound(error: unknown): boolean {
  const status = statusOf(error);
  const name = error instanceof Error ? error.name : "";
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}

function statusOf(error: unknown): number {
  const metadata = (
    error as { $metadata?: { httpStatusCode?: number } } | undefined
  )?.$metadata;
  return metadata?.httpStatusCode ?? 0;
}

function asStorageError(what: string, error: unknown): StorageError {
  const reason = error instanceof Error ? error.message : String(error);
  return new StorageError(statusOf(error), `Storage ${what} failed: ${reason}`);
}
