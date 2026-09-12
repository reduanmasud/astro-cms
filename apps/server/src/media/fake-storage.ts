import { StorageError, type MediaStorage, type ObjectHead } from "./storage.ts";

interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly uploadedAt: Date;
}

export interface FakeStorage {
  readonly storage: MediaStorage;
  /** Keys currently held, in upload order. */
  keys(): string[];
  bodyOf(key: string): Uint8Array | undefined;
  /** Make the next call of this kind fail, to test error paths. */
  failNext(operation: "upload" | "delete" | "head", status?: number): void;
}

const PUBLIC_URL = "https://media.test";

/** An in-memory object store with the same contract as the S3 adapter. */
export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, StoredObject>();
  const failures = new Map<string, number>();

  function guard(operation: string): void {
    const status = failures.get(operation);
    if (status !== undefined) {
      failures.delete(operation);
      throw new StorageError(status, `Fake storage ${operation} failure`);
    }
  }

  const storage: MediaStorage = {
    upload({ key, body, contentType }) {
      guard("upload");
      objects.set(key, { body, contentType, uploadedAt: new Date() });
      return Promise.resolve();
    },

    delete(key) {
      guard("delete");
      objects.delete(key);
      return Promise.resolve();
    },

    exists(key) {
      guard("head");
      return Promise.resolve(objects.has(key));
    },

    head(key) {
      guard("head");
      const object = objects.get(key);
      if (!object) return Promise.resolve(undefined);
      return Promise.resolve({
        contentType: object.contentType,
        size: object.body.byteLength,
        lastModified: object.uploadedAt,
      } satisfies ObjectHead);
    },

    publicUrl(key) {
      return `${PUBLIC_URL}/${key}`;
    },
  };

  return {
    storage,
    keys: () => [...objects.keys()],
    bodyOf: (key) => objects.get(key)?.body,
    failNext: (operation, status = 500) => failures.set(operation, status),
  };
}
