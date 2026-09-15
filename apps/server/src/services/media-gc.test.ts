import { deflateSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Db } from "../db/database.ts";
import { createDocumentRepository } from "../db/document-repository.ts";
import {
  createMediaRepository,
  type MediaRepository,
} from "../db/media-repository.ts";
import { createFakeStorage, type FakeStorage } from "../media/fake-storage.ts";
import { createDocumentService } from "./documents.ts";
import { createMediaService, type MediaService } from "./media.ts";
import { createMediaReferenceTracker } from "./media-references.ts";
import type { MediaGitScanner } from "./media-git-scanner.ts";
import {
  createMediaCollector,
  startCollecting,
  type MediaCollector,
} from "./media-gc.ts";

function png(): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.byteLength);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.alloc(5))),
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

const DAY = 24 * 60 * 60 * 1000;
const PUBLIC_URL = "https://media.test";

/** A scanner that records nothing, standing in for a quiet repository. */
const quietScanner: MediaGitScanner = {
  scan: () => Promise.resolve({ refs: 1, read: 0, files: 0, references: 0 }),
};

describe("media collector", () => {
  let db: Db;
  let repository: MediaRepository;
  let storage: FakeStorage;
  let media: MediaService;
  let now: number;

  function build(scanner: MediaGitScanner = quietScanner): MediaCollector {
    const documents = createDocumentService({
      repository: createDocumentRepository(db),
    });
    return createMediaCollector({
      media,
      repository,
      references: createMediaReferenceTracker({
        repository,
        documents,
        publicUrl: PUBLIC_URL,
        now: () => now,
      }),
      scanner,
      graceMs: 7 * DAY,
      now: () => now,
    });
  }

  async function upload(id: string): Promise<string> {
    const { media: item } = await media.upload(
      { filename: `${id}.png`, bytes: png() },
      null,
    );
    return item.id;
  }

  beforeEach(() => {
    now = 100 * DAY;
    db = openDatabase(":memory:");
    repository = createMediaRepository(db);
    storage = createFakeStorage();
    media = createMediaService({ repository, storage: storage.storage });
  });

  it("deletes a file that has been unused past the grace period", async () => {
    const id = await upload("a");
    repository.refreshUnusedMarkers(now - 8 * DAY);

    const summary = await build().collect();

    expect(summary).toMatchObject({ deleted: 1, failed: 0, skipped: false });
    expect(storage.keys()).toEqual([]);
    expect(repository.findById(id)).toBeUndefined();
  });

  it("keeps a file still inside the grace period", async () => {
    await upload("a");
    repository.refreshUnusedMarkers(now - 2 * DAY);

    const summary = await build().collect();

    expect(summary.deleted).toBe(0);
    expect(storage.keys()).toHaveLength(1);
  });

  it("keeps a file the repository still references", async () => {
    const id = await upload("a");
    repository.refreshUnusedMarkers(now - 30 * DAY);
    repository.setGitReferences("main", [
      { mediaId: id, path: "src/content/blog/hello.md" },
    ]);

    const summary = await build().collect();

    expect(summary.deleted).toBe(0);
    expect(storage.keys()).toHaveLength(1);
  });

  it("deletes nothing at all when the scan fails", async () => {
    await upload("a");
    repository.refreshUnusedMarkers(now - 30 * DAY);
    const broken: MediaGitScanner = {
      scan: () => Promise.reject(new Error("GitHub is unreachable")),
    };

    const summary = await build(broken).collect();

    expect(summary).toMatchObject({ deleted: 0, skipped: true });
    expect(storage.keys()).toHaveLength(1);
  });

  it("counts a file it could not remove from storage, and keeps its row", async () => {
    const id = await upload("a");
    repository.refreshUnusedMarkers(now - 30 * DAY);
    storage.failNext("delete", 500);

    const summary = await build().collect();

    expect(summary).toMatchObject({ deleted: 0, failed: 1 });
    expect(repository.findById(id)).toBeDefined();
  });

  it("does nothing when storage is not configured", async () => {
    const off = createMediaService({ repository, storage: null });
    const collector = createMediaCollector({
      media: off,
      repository,
      references: createMediaReferenceTracker({
        repository,
        documents: createDocumentService({
          repository: createDocumentRepository(db),
        }),
        publicUrl: null,
        now: () => now,
      }),
      scanner: quietScanner,
      graceMs: 7 * DAY,
      now: () => now,
    });

    await expect(collector.collect()).resolves.toMatchObject({
      deleted: 0,
      skipped: true,
    });
  });
});

describe("startCollecting", () => {
  it("sweeps on a timer until stopped", async () => {
    vi.useFakeTimers();
    const collect = vi.fn().mockResolvedValue({
      deleted: 0,
      failed: 0,
      candidates: 0,
      skipped: false,
    });

    const stop = startCollecting({
      collect,
      intervalMs: 60_000,
      firstRunDelayMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(collect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collect).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(collect).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("keeps sweeping after one run throws", async () => {
    vi.useFakeTimers();
    const collect = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({
        deleted: 0,
        failed: 0,
        candidates: 0,
        skipped: false,
      });

    const stop = startCollecting({
      collect,
      intervalMs: 60_000,
      firstRunDelayMs: 0,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(collect).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });
});
