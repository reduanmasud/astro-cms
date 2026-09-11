# ADR-0008: Media in S3-compatible storage with reference-counted GC

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

Editors paste images into drafts. Committing binaries to the Git repository
bloats it, and images uploaded to drafts that are later abandoned accumulate.
The CMS must work with Cloudflare R2, AWS S3, and MinIO.

## Decision

Media binaries go to an S3-compatible bucket through the AWS S3 SDK. SQLite
stores metadata only. A periodic job counts references from drafts, open CMS
PRs, and `main`. Media with zero references is marked unused with a timestamp.
After 7 days unused, references are rechecked immediately, and the object is
deleted only if still unreferenced.

## Alternatives Considered

### Commit images into the repository

- **Pros**: No bucket needed. Astro can optimize local images.
- **Cons**: Repository bloat, binary diffs in PRs, uploads tied to publishing.
- **Why not**: The project brief puts media in object storage.

### Never delete media

- **Pros**: No risk of deleting something in use.
- **Cons**: Unbounded storage growth from abandoned drafts.
- **Why not**: The brief requires garbage collection.

### Delete immediately at zero references

- **Pros**: Minimal storage.
- **Cons**: Races with in-flight pastes, undo, and PRs being reopened.
- **Why not**: A grace period plus a recheck is much safer.

## Consequences

### Positive

- The Git repository stays small.
- Deletion is conservative: 7 days, then a recheck.

### Negative

- Published content depends on the bucket being publicly readable at a stable URL.
- Reference scanning needs GitHub API calls ([ADR-0003](0003-github-api-no-clone.md)).

### Risks

- References outside scanned locations (e.g. hard-coded in `.astro` components)
  would be missed. Mitigation: document which paths are scanned. Consider
  scanning more paths only if users report it.
