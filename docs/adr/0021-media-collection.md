# ADR-0021: Media collection: three reference sources, and proof before deletion

**Date**: 2026-09-15
**Status**: accepted
**Implements**: [ADR-0008](0008-media-storage-and-gc.md), [ADR-0017](0017-media-storage.md)
**Deciders**: Project maintainers

## Context

[ADR-0008](0008-media-storage-and-gc.md) sketched a periodic job that counts
references from drafts, open CMS pull requests, and `main`, then deletes
whatever stays unreferenced past a grace period.
[ADR-0017](0017-media-storage.md) built the draft half of that — a file's
`media_references` come from the drafts in SQLite — and left the repository
half, scanning pull requests and `main`, for when publishing existed. It now
does. This decision records how that other half was actually built: where a
git reference is stored, what triggers a rescan, and what a sweep does when
it cannot trust what it read.

## Decision

**References now come from three sources**, and they end up in two tables.
A draft's own Markdown is unchanged: `media_references` maps a file to the
document that uses it, and cascades away when the document is deleted. A
reference found in the repository — on the base branch or on an open `cms/`
branch — goes into a new table, `media_git_references(media_id, ref, path)`,
because it belongs to a ref and a path, not a document; a branch can close or
move independently of any document row, and deleting a document must never
touch what `main` still serves. `MediaRecord.referenceCount` sums both
tables, so every caller sees one number regardless of where a reference came
from.

Counting both tables this way incidentally fixes a bug in
`DELETE /api/media/:id`. Until now the endpoint refused deletion only when
`media_references` showed a draft using the file, so a file used solely by
published content on the base branch could be deleted through that route.
With `referenceCount` covering git references too, the same check now
refuses correctly.

**Only `.md` and `.mdx` files under each collection's `contentPath` are
scanned**, for the base branch and every currently open `cms/` branch.
`services/media-git-scanner.ts` keeps an in-memory `Map<ref, commitSha>`: a
ref whose head has not moved since the last sweep is skipped without reading
a single file, so a quiet sweep costs one head check per ref and nothing
more. That cache lives only in memory, so a process restart re-reads every
open ref once before it goes quiet again.

**A sweep that cannot read the repository deletes nothing.**
`services/media-gc.ts` recomputes draft references, then asks the scanner to
rescan. If either step throws — a GitHub API error, a file that failed to
read, anything — the sweep stops there and deletes nothing for that run.
Zero references produced by a failed scan is indistinguishable from zero
references produced by a real one, and only a sweep that finished both steps
without error is allowed to treat "unreferenced" as true. Deletion still
requires `unused_since` older than the grace period, so one failed sweep
costs nothing but a delay; the next successful sweep gets to try again.

An empty answer counts as a failure, not a result. The scanner throws rather
than returning nothing when the project resolves to no content roots (a
missing `src/content.config.*`, or loaders the static parser cannot model),
when the base branch itself is absent — only a `cms/` branch may be pruned
for having disappeared — and the GitHub client refuses to return a truncated
list of open pull requests. Each of those would otherwise look like a
successful scan that found nothing, and wipe live references.

`MEDIA_GC_INTERVAL_HOURS` (default 6, `0` disables the timer) and
`MEDIA_GC_GRACE_DAYS` (default 7, minimum 1) control the schedule. The grace
period has a floor because a zero-day grace is the no-grace-period option
rejected below, reached by configuration instead of by decision. The
collector is never constructed, and no timer starts, when media storage is
unconfigured.

## Alternatives Considered

### A persisted scan-state table

- **Pros**: Survives a restart without rereading every open ref; a very
  large repository would resume rather than start cold.
- **Cons**: Another table and another migration, holding state that can
  drift from the ref it describes — a force-pushed branch still needs
  invalidating, persisted or not.
- **Why not**: A restart is rare, and rereading every open ref once costs
  far less than the machinery needed to persist and invalidate that state
  correctly. Revisit if the number of open branches, or the size of the
  content tree, makes a cold rescan slow enough to matter.

### Scanning every file in the repository

- **Pros**: Would catch a media URL that leaked into a non-content file —
  an `.astro` component, a script, a fixture — that the current scan
  cannot see.
- **Cons**: Far more files read and far more GitHub API calls per sweep,
  almost all of them irrelevant to content references.
- **Why not**: [ADR-0008](0008-media-storage-and-gc.md) already accepted
  this gap as a known risk and required that the scanned paths be
  documented rather than the gap closed by scanning everything. This
  decision keeps that call: only `.md`/`.mdx` under a collection's
  `contentPath`.

### Deleting as soon as a file has zero references, no grace period

- **Pros**: Minimal storage retained at any moment.
- **Cons**: Races with an in-flight paste before a draft is saved, an
  undo, or a closed pull request being reopened — any of which can leave a
  reference that has not been recorded yet.
- **Why not**: [ADR-0008](0008-media-storage-and-gc.md) already settled on
  a grace period for exactly this reason. This decision does not reopen
  it; it applies the same grace period to a reference count now drawn
  from all three sources together, not drafts alone.

## Consequences

### Positive

- One reference count, drawn from three sources, answers both "is this
  file safe to collect" and "can I delete it right now" consistently —
  the bug where the latter ignored git references is gone.
- A quiet sweep, with no commits since the last one, costs one head check
  per open ref and reads no files at all.
- A scan that fails cannot cause a wrongful deletion; the worst a bad
  sweep does is delete nothing and wait for the next one.

### Negative

- The scanner only looks inside `.md` and `.mdx` files under a
  collection's `contentPath`. A media URL referenced only from elsewhere —
  an `.astro` component, a script, a fixture — is invisible to it and will
  eventually be collected as unused. An operator must know this before
  enabling collection; it is documented in the README.
- Every open `cms/` branch that has moved is rescanned on the next sweep.
  A repository carrying many long-lived open branches makes each sweep
  proportionally more expensive.

### Risks

- The in-memory scan cache means a restart triggers one full rescan of
  every open ref before quiet sweeps resume. On a repository with very
  many open branches, the first sweep after a deploy could take
  noticeably longer than the rest. Mitigation: none needed at current
  scale; the persisted-scan-state alternative above is the fallback if
  this becomes a problem.
- A sweep that fails on every run — a persistently misconfigured GitHub
  token, for instance — accumulates unused media forever rather than
  deleting anything. Mitigation: a refused sweep is not an exception, so
  `onError` never sees it; instead `collect` returns `skipped: true` with a
  `reason` (`scan_failed` or `storage_disabled`) and the error that stopped
  it, and `onSweep` logs that at error level on every such run. An operator
  watching logs sees one line per refused sweep, naming the cause.
