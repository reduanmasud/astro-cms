import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inspectUpload, objectKeyFor, MAX_UPLOAD_BYTES } from "./inspect.ts";

/** A real 1x1 PNG, built here so the test does not need a fixture file. */
function png(width = 1, height = 1): Uint8Array {
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
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const pixels = Buffer.alloc(height * (width * 4 + 1));

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x03, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00,
  0x02, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

describe("inspectUpload", () => {
  it("reads the type, size, hash, and dimensions of a PNG", () => {
    const bytes = png(4, 3);

    const result = inspectUpload(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toMatchObject({
      contentType: "image/png",
      extension: "png",
      size: bytes.byteLength,
      width: 4,
      height: 3,
    });
    expect(result.file.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("accepts a GIF and reports its dimensions", () => {
    const result = inspectUpload(GIF);

    expect(result.ok && result.file).toMatchObject({
      contentType: "image/gif",
      width: 3,
      height: 2,
    });
  });

  it("rejects an empty file", () => {
    expect(inspectUpload(new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: "empty" },
    });
  });

  it("rejects a file over the limit", () => {
    const result = inspectUpload(png(), 10);

    expect(result).toMatchObject({ ok: false, error: { code: "too_large" } });
  });

  it("rejects bytes that are not an accepted image", () => {
    const text = new TextEncoder().encode("#!/bin/sh\necho hi\n");

    expect(inspectUpload(text)).toMatchObject({
      ok: false,
      error: { code: "unsupported_type" },
    });
  });

  it("rejects SVG, which can carry scripts", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    );

    expect(inspectUpload(svg)).toMatchObject({
      ok: false,
      error: { code: "unsupported_type" },
    });
  });

  it("ignores a lying file name: the bytes decide", () => {
    const text = new TextEncoder().encode("not really a png");

    // Nothing about the name reaches this function; only the bytes do.
    expect(inspectUpload(text).ok).toBe(false);
  });

  it("defaults to a 10 MB limit", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("objectKeyFor", () => {
  it("spreads files over prefixes and keeps the extension", () => {
    const sha = "abcdef1234567890".repeat(4);

    expect(objectKeyFor(sha, "png")).toBe(`media/ab/${sha}.png`);
  });

  it("gives the same bytes the same key", () => {
    const first = inspectUpload(png());
    const second = inspectUpload(png());

    expect(
      first.ok && second.ok && first.file.sha256 === second.file.sha256,
    ).toBe(true);
  });
});
