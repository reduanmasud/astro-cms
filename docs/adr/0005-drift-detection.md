# ADR-0005: Detect drift with base_commit_sha, no automatic merge

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

A draft lives in SQLite while `main` keeps moving. If `main` changes after the
draft started, publishing blindly could overwrite someone else's work or open a
PR against stale content.

## Decision

When a draft starts or re-syncs, we store the current `main` commit SHA as
`base_commit_sha`. Before publishing, we compare it with the current `main` SHA.
If they differ, publishing stops and the UI (or MCP tool) reports a conflict and
asks the user to re-sync. v1 does no automatic merging.

## Alternatives Considered

### Three-way merge of Markdown

- **Pros**: Fewer interruptions for editors.
- **Cons**: Markdown/MDX merging is error-prone. Silent bad merges lose content.
- **Why not**: Correctness over convenience in v1.

### Compare only the content item's own file

- **Pros**: Unrelated commits to `main` would not block publishing.
- **Cons**: Misses changes that matter to the item, e.g. an edited
  `content.config.ts` schema.
- **Why not**: The whole-branch rule is simpler and safe. Narrowing it is a
  possible later refinement that needs its own ADR.

### Last write wins

- **Pros**: Simplest.
- **Cons**: Overwrites other people's changes.
- **Why not**: Unacceptable data-loss risk.

## Consequences

### Positive

- The CMS never publishes against a `main` it has not seen.
- Easy to explain and test.

### Negative

- On an active repository, any commit to `main` forces a re-sync before
  publishing, even if it touched unrelated files.

### Risks

- Re-sync must not throw away the user's draft. Mitigation: the re-sync flow
  must show the draft next to the new `main` version before replacing anything.
  Designed when publishing is built.
