# Media garbage collection: prove it is unused, then delete it

**Date**: 2026-09-15
**Status**: approved, not yet implemented
**Implements**: [ADR-0008](../../adr/0008-media-storage-and-gc.md)

## Goal

Delete media nothing references any more, and never delete anything else.

Today the CMS marks: a file no draft mentions gets stamped `unused_since`,
and there it stays forever. Nothing counts references from published content,
and nothing ever deletes. Publishing now exists, so the two missing sources —
open CMS pull requests and the base branch — are finally there to read.

## Decisions

Settled before design, and not revisited here:

- **A timer inside the process.** No cron, no second service
  ([ADR-0001](../../adr/0001-single-node-process.md)).
- **Seven days, configurable.** The default ADR-0008 records, with an
  environment variable so an operator — and a test — can change it.
- **Content files only.** The Markdown and MDX under each collection's
  content path, on `main` and on each open `cms/` branch.

## Shape

```
       every MEDIA_GC_INTERVAL_HOURS
                   │
                   ▼
        services/media-gc.ts ── collect()
                   │
     ┌─────────────┼──────────────┐
     ▼             ▼              ▼
  drafts     open cms/ PRs      main         ← references
 (SQLite)      (GitHub)       (GitHub)
                   │
                   ▼
        unused_since older than the grace period,
        and still zero references after this scan
                   │
                   ▼
        storage.delete, then the row
```

`media-references.ts` counts. `media-gc.ts` deletes. Keeping those apart is
what makes the tracker safe to call on every upload and every media listing.

## Where references come from

Drafts already work, and their references live in `media_references`, keyed
to a document so they cascade when a draft is deleted.

Git references have no document to hang from, so **migration 4** adds a
second table:

```sql
CREATE TABLE media_git_references (
  media_id TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  ref TEXT NOT NULL,          -- "main", or "cms/blog/hello"
  path TEXT NOT NULL,         -- src/content/blog/hello.md
  PRIMARY KEY (media_id, ref, path)
) STRICT;
CREATE INDEX media_git_references_ref ON media_git_references (ref);
```

Two tables rather than one widened table: draft references belong to a
document and cascade with it, git references belong to a ref and are replaced
wholesale when that ref is rescanned. Different lifecycles, different tables.

`MediaRecord.referenceCount` counts **both**. That fixes a bug that exists
today, quite apart from collection: `DELETE /api/media/:id` currently refuses
only when a _draft_ uses a file, so it would cheerfully delete an image that
is live on `main`.

## Scanning without hammering GitHub

A naive sweep reads every content file on every ref — on this repository,
210 files per ref, and most sweeps change nothing.

So the collector keeps an in-memory `Map<ref, commitSha>` and skips any ref
whose head has not moved since the last sweep. A restart costs one full scan,
which is cheap enough that persisting the cache would be more machinery than
it saves.

For each ref that has moved: list the tree, keep paths under a collection's
`contentPath` ending in `.md` or `.mdx`, read those, extract media URLs with
the same matcher the draft scanner uses, and replace that ref's rows.

Refs that no longer exist — a merged pull request's branch — have their rows
deleted.

## The collector

```
collect(now)
  1. recompute drafts, main, and every open cms/ branch
  2. refresh unused markers
  3. candidates = media where unused_since <= now - grace
                    and referenceCount is 0
  4. for each: storage.delete(objectKey), then repository.delete(id)
  5. return { scanned, marked, deleted, skipped, failed }
```

Step 1 **is** the recheck ADR-0008 requires: references are recomputed
immediately before anything is deleted, in the same sweep.

Deletion order matches `media.delete`: the object first, then the row. A
leftover row is easier to explain than a URL that 404s.

## Scheduling

| Variable                  | Default | Meaning                        |
| ------------------------- | ------- | ------------------------------ |
| `MEDIA_GC_INTERVAL_HOURS` | 6       | `0` switches collection off    |
| `MEDIA_GC_GRACE_DAYS`     | 7       | Unused for this long, then out |

The first sweep runs a minute after startup, not immediately: a CMS that has
just booted should answer requests before it starts talking to GitHub. The
timer is `unref`'d so it never holds the process open, and it is cleared on
shutdown alongside the server.

Collection does not start at all when storage is unconfigured. There is
nothing to delete from.

## The safety rule

**A sweep that cannot read GitHub deletes nothing.**

Zero references from a failed scan looks exactly like zero references from a
successful one, and the rule this project holds is that deletion requires
proof of disuse, not absence of evidence. So any error while scanning any ref
aborts the delete phase for that sweep; the sweep logs what happened and the
next one tries again.

The same applies per-file: if `storage.delete` throws, that file is counted
in `failed`, its row is kept, and the sweep moves on.

## Two small additions to RepositoryService

The collector needs two read-only operations the service does not expose yet,
both already present on `GitHubClient`:

- `listOpenPullRequests(): Promise<PullRequest[]>` — to find open `cms/`
  branches.
- `getBranchHead(branch: string): Promise<string | undefined>` — for the
  unchanged-SHA check. `PullRequest` carries a branch name but no commit.

## Errors

| Situation                        | What happens                           |
| -------------------------------- | -------------------------------------- |
| Storage unconfigured             | The collector never starts.            |
| GitHub unreachable during a scan | Nothing is deleted this sweep; logged. |
| One object fails to delete       | Counted in `failed`, its row is kept.  |
| A ref disappears mid-sweep       | Its rows are dropped; not an error.    |

## Testing

Against the fake GitHub client and the in-memory storage fake:

- A file referenced only on `main` is never marked unused.
- A file referenced only by an open `cms/` pull request is never marked.
- A file referenced nowhere is marked, survives until the grace period
  passes, and is then deleted from both storage and SQLite.
- A file that gains a reference during the grace period survives the
  recheck, and its marker is cleared.
- `DELETE /api/media/:id` refuses a file that is live on `main`.
- A GitHub failure mid-scan deletes nothing at all.
- A ref whose head has not moved is not read again.
- A merged branch's references are dropped when the branch disappears.
- With storage unconfigured, the collector does not start.
- Grace and interval come from configuration, so tests set them directly
  rather than manipulating clocks.

## Out of scope

An endpoint or MCP tool to trigger a sweep — `GET /api/media?unused=true`
already shows what is unused and since when. Scanning non-content files,
closed pull requests, or branches the CMS did not create. Restoring deleted
media. Reporting sweep history in the UI.

## Risks

- **A URL hard-coded outside content is missed** — in an `.astro` component,
  say. [ADR-0008](../../adr/0008-media-storage-and-gc.md) names this and says
  to document the scanned paths rather than widen speculatively. The README
  will say which paths are scanned.
- **The in-memory SHA cache trusts that a ref's content follows its head.**
  True for Git, and a restart re-reads everything anyway.
- **Seven days is a guess.** It is configurable, and the recheck means the
  grace period is the outer net rather than the only one.
