# ADR-0017: Media in S3-compatible storage, content-addressed, metadata in SQLite

**Date**: 2026-09-12
**Status**: accepted
**Implements**: [ADR-0008](0008-media-storage-and-gc.md)
**Deciders**: Project maintainers

## Context

[ADR-0008](0008-media-storage-and-gc.md) settled where media lives: binaries
in an S3-compatible bucket, metadata in SQLite, unused files garbage-collected
later. This decision covers how that is built, and the rules that keep the
CMS from serving something harmful or losing track of a file.

## Decision

**One storage interface.** `MediaStorage` has five methods — `upload`,
`delete`, `exists`, `head`, `publicUrl` — with an S3 implementation
(`@aws-sdk/client-s3`, path-style addressing so MinIO and Cloudflare R2 work)
and an in-memory fake for tests. Credentials exist only inside the adapter;
the browser receives public URLs and nothing else. Storage is configured by
`S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and
`S3_PUBLIC_URL` — all six or none.

**Content-addressed objects.** The key is `media/<first two hex>/<sha256>.<ext>`,
so the same bytes always land on the same object. Uploading a file twice
stores it once and returns the existing record.

**The bytes decide the type.** Every upload is inspected with `image-size`:
the format comes from the file's own header, not from the browser's
`Content-Type` or the file name. PNG, JPEG, GIF, WebP, and AVIF are accepted;
anything else is refused with 415. Uploads are capped at 10 MB.

**SVG is not accepted.** It can carry scripts, and nothing here sanitizes it.

**Metadata in SQLite.** `media` holds the key, original filename, content
type, size, SHA-256, image dimensions, uploader, timestamp, and
`unused_since`. `media_references` records which draft uses which file;
references are recomputed from draft sources, and a file with none is stamped
so a later collector can age it out. Deleting a file that a draft still uses
is refused.

## Alternatives Considered

### Presigned upload URLs straight from the browser

- **Pros**: Bytes skip the CMS, so large files cost it nothing.
- **Cons**: The CMS never sees the bytes, so it cannot check the real format,
  measure dimensions, or hash for deduplication; the browser also learns the
  bucket and key layout.
- **Why not**: Validation is the point. Revisit if large uploads become a
  problem, with the checks moved to a callback.

### Random object keys with a separate hash column

- **Pros**: No hashing before upload.
- **Cons**: The same image uploaded from three drafts is stored three times.
- **Why not**: Deduplication is free once the hash is computed anyway.

### Trusting the browser's Content-Type

- **Pros**: No image parsing.
- **Cons**: A `.png` that is really a script would be stored and served.
- **Why not**: Never trust a value the client controls.

## Consequences

### Positive

- Storage credentials cannot leak to the browser; they never leave the server.
- Duplicate images cost nothing, and a file's identity is its content.
- Every stored object is a real image of a known type, size, and dimensions.

### Negative

- Uploads pass through the CMS, so a large file occupies it briefly.
- Rewriting an image (even losslessly) makes a new object; the old one becomes
  unused rather than being replaced.

### Risks

- References are counted from drafts only. A file used solely by published
  content on `main` would look unused. Mitigation: nothing is deleted
  automatically yet; the collector arrives with publishing, when pull requests
  and `main` are scanned as [ADR-0008](0008-media-storage-and-gc.md) requires.
- An upload that reaches storage but fails to record metadata leaves an
  orphaned object. Mitigation: the object is content-addressed, so the next
  upload of the same bytes adopts it.
