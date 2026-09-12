import { deflateSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database.ts";
import { createDocumentRepository } from "../db/document-repository.ts";
import {
  createMediaRepository,
  type MediaRepository,
} from "../db/media-repository.ts";
import type { CollaboratorRef } from "../documents/model.ts";
import { createFakeStorage, type FakeStorage } from "../media/fake-storage.ts";
import { createDocumentService, type DocumentService } from "./documents.ts";
import { createMediaReferenceTracker } from "./media-references.ts";
import { createMediaService, MediaError, type MediaService } from "./media.ts";

const ADA: CollaboratorRef = { id: "c1", name: "Ada" };
const PUBLIC_URL = "https://media.test";

/** A real PNG of the given size, so image-size can measure it. */
function png(width = 2, height = 2): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.byteLength);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.alloc(height * (width * 4 + 1)))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("media service", () => {
  let db: Db;
  let fake: FakeStorage;
  let repository: MediaRepository;
  let media: MediaService;
  let documents: DocumentService;

  beforeEach(() => {
    db = openDatabase(":memory:");
    db.prepare("INSERT INTO collaborators VALUES ('c1','Ada',1,1)").run();
    fake = createFakeStorage();
    repository = createMediaRepository(db);
    documents = createDocumentService({
      repository: createDocumentRepository(db),
    });
    media = createMediaService({ repository, storage: fake.storage });
  });

  function errorCode(run: () => unknown): string | undefined {
    try {
      run();
    } catch (error) {
      if (error instanceof MediaError) return error.code;
      throw error;
    }
    return undefined;
  }

  async function asyncErrorCode(
    run: () => Promise<unknown>,
  ): Promise<string | undefined> {
    try {
      await run();
      return undefined;
    } catch (error) {
      if (error instanceof MediaError) return error.code;
      throw error;
    }
  }

  describe("upload", () => {
    it("stores the bytes and records size, hash, type, and dimensions", async () => {
      const bytes = png(4, 3);

      const { media: item, created } = await media.upload(
        { filename: "hero.png", bytes },
        ADA,
      );

      expect(created).toBe(true);
      expect(item).toMatchObject({
        filename: "hero.png",
        contentType: "image/png",
        size: bytes.byteLength,
        width: 4,
        height: 3,
        uploadedBy: ADA,
        referenceCount: 0,
      });
      expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(item.url).toBe(`${PUBLIC_URL}/${item.objectKey}`);
      expect(fake.keys()).toEqual([item.objectKey]);
    });

    it("stores identical bytes once and returns the same record", async () => {
      const first = await media.upload(
        { filename: "a.png", bytes: png() },
        ADA,
      );
      const second = await media.upload(
        { filename: "copy.png", bytes: png() },
        ADA,
      );

      expect(second.created).toBe(false);
      expect(second.media.id).toBe(first.media.id);
      expect(fake.keys()).toHaveLength(1);
      expect(media.list()).toHaveLength(1);
    });

    it("keeps different images apart", async () => {
      await media.upload({ filename: "a.png", bytes: png(2, 2) }, ADA);
      await media.upload({ filename: "b.png", bytes: png(5, 5) }, ADA);

      expect(fake.keys()).toHaveLength(2);
      expect(media.list()).toHaveLength(2);
    });

    it.each([
      ["an empty file", new Uint8Array(), "empty"],
      [
        "a non-image",
        new TextEncoder().encode("#!/bin/sh"),
        "unsupported_type",
      ],
    ])("refuses %s", async (_label, bytes, code) => {
      expect(
        await asyncErrorCode(() =>
          media.upload({ filename: "x.png", bytes }, ADA),
        ),
      ).toBe(code);
    });

    it("refuses a file over the limit", async () => {
      const small = createMediaService({
        repository,
        storage: fake.storage,
        maxBytes: 10,
      });

      expect(
        await asyncErrorCode(() =>
          small.upload({ filename: "big.png", bytes: png() }, ADA),
        ),
      ).toBe("too_large");
    });

    it("refuses a nameless file", async () => {
      expect(
        await asyncErrorCode(() =>
          media.upload({ filename: "   ", bytes: png() }, ADA),
        ),
      ).toBe("invalid");
    });

    it("stores nothing when the upload fails", async () => {
      fake.failNext("upload");

      await expect(
        media.upload({ filename: "a.png", bytes: png() }, ADA),
      ).rejects.toThrow();
      expect(media.list()).toEqual([]);
    });
  });

  describe("get, list, and verify", () => {
    it("reads one item and reports a missing id", async () => {
      const { media: item } = await media.upload(
        { filename: "a.png", bytes: png() },
        ADA,
      );

      expect(media.get(item.id).id).toBe(item.id);
      expect(errorCode(() => media.get("missing"))).toBe("not_found");
    });

    it("asks storage whether the object is really there", async () => {
      const { media: item } = await media.upload(
        { filename: "a.png", bytes: png() },
        ADA,
      );

      await expect(media.verify(item.id)).resolves.toMatchObject({
        contentType: "image/png",
        size: item.size,
      });

      await fake.storage.delete(item.objectKey);
      await expect(media.verify(item.id)).resolves.toBeUndefined();
    });

    it("rejects out-of-range paging", () => {
      expect(errorCode(() => media.list({ limit: 0 }))).toBe("invalid");
      expect(errorCode(() => media.list({ offset: -1 }))).toBe("invalid");
    });
  });

  describe("delete", () => {
    it("removes the object and the metadata", async () => {
      const { media: item } = await media.upload(
        { filename: "a.png", bytes: png() },
        ADA,
      );

      await media.delete(item.id);

      expect(fake.keys()).toEqual([]);
      expect(errorCode(() => media.get(item.id))).toBe("not_found");
    });

    it("refuses while a draft still uses it", async () => {
      const { media: item } = await media.upload(
        { filename: "a.png", bytes: png() },
        ADA,
      );
      const draft = documents.create(
        {
          collection: "blog",
          path: "src/content/blog/a.md",
          source: `![hero](${item.url})`,
        },
        ADA,
      );
      createMediaReferenceTracker({
        repository,
        documents,
        publicUrl: PUBLIC_URL,
      }).recompute();

      expect(await asyncErrorCode(() => media.delete(item.id))).toBe("in_use");
      expect(fake.keys()).toHaveLength(1);
      expect(documents.get(draft.id).source).toContain(item.url);
    });

    it("reports a missing id", async () => {
      expect(await asyncErrorCode(() => media.delete("missing"))).toBe(
        "not_found",
      );
    });
  });

  describe("when storage is not configured", () => {
    it("is off and refuses to upload", async () => {
      const off = createMediaService({ repository, storage: null });

      expect(off.isEnabled()).toBe(false);
      expect(
        await asyncErrorCode(() =>
          off.upload({ filename: "a.png", bytes: png() }, ADA),
        ),
      ).toBe("not_configured");
    });
  });
});
