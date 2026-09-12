import { createHash } from "node:crypto";
import { imageSize } from "image-size";

/**
 * What the CMS learns about an uploaded file before storing it: its real
 * format (read from the bytes, never from the browser's Content-Type), its
 * size, a content hash, and image dimensions.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Formats the CMS accepts. SVG is deliberately missing: it can carry scripts,
 * and nothing here sanitizes it (docs/adr/0017-media-storage.md).
 */
export const ALLOWED_TYPES: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
]);

export interface InspectedFile {
  readonly contentType: string;
  readonly extension: string;
  readonly size: number;
  /** Lowercase hex SHA-256 of the bytes. */
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export type InspectionError =
  | { readonly code: "empty"; readonly message: string }
  | { readonly code: "too_large"; readonly message: string }
  | { readonly code: "unsupported_type"; readonly message: string };

export type InspectionResult =
  | { readonly ok: true; readonly file: InspectedFile }
  | { readonly ok: false; readonly error: InspectionError };

/** Reads the bytes themselves; the declared type and file name are only hints. */
export function inspectUpload(
  bytes: Uint8Array,
  maxBytes = MAX_UPLOAD_BYTES,
): InspectionResult {
  if (bytes.byteLength === 0) {
    return fail("empty", "The file is empty.");
  }
  if (bytes.byteLength > maxBytes) {
    return fail(
      "too_large",
      `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    );
  }

  let measured;
  try {
    measured = imageSize(bytes);
  } catch {
    return fail(
      "unsupported_type",
      "Only PNG, JPEG, GIF, WebP, and AVIF images are accepted.",
    );
  }

  const extension = measured.type ?? "";
  const contentType = ALLOWED_TYPES.get(extension);
  if (contentType === undefined) {
    return fail(
      "unsupported_type",
      `${extension === "" ? "That file" : `A ${extension} file`} is not accepted. Use PNG, JPEG, GIF, WebP, or AVIF.`,
    );
  }

  return {
    ok: true,
    file: {
      contentType,
      extension,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: measured.width,
      height: measured.height,
    },
  };
}

/** Content-addressed key: the same bytes always land on the same object. */
export function objectKeyFor(sha256: string, extension: string): string {
  return `media/${sha256.slice(0, 2)}/${sha256}.${extension}`;
}

function fail(
  code: InspectionError["code"],
  message: string,
): InspectionResult {
  return { ok: false, error: { code, message } };
}
