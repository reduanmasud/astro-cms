# ADR-0023: Media library: references from a shared service, no upload, no thumbnails

**Date**: 2026-09-16
**Status**: accepted
**Implements**: [media library design](../superpowers/specs/2026-09-16-media-library-design.md)
**Builds on**: [ADR-0017](0017-media-storage.md), [ADR-0021](0021-media-collection.md)

## Context

The media subsystem has been finished and invisible since ADR-0021: files
upload, deduplicate by content hash, accumulate references from drafts and
from the repository, and get collected once unreferenced past a grace
period. None of it reached the web interface, where the only media
operation was pasting an image into a post. An editor who wanted to know
what a file was, whether it was safe to remove, or where it was still used
had no way to ask.

Everything the answer needed already existed except the answer itself.
`MediaRecord.referenceCount` is a number; the two tables behind it —
`media_references` and `media_git_references` — know the places. What was
missing was a way to name them, and a page to show the result.

## Decision

**A `references(id)` method on the media service, not a query in the
route**, answers "where is this used?" It joins `media_references` to
`documents` for the draft side, so a caller sees a path like
`blog/my-post.mdx` rather than a document id, and reads
`media_git_references` directly for the git side. `GET
/api/media/:id/references` calls it, and so does a new MCP tool,
`get_media_references`, alongside `list_media`, `get_media`, and
`upload_media`. The service method exists precisely so those two callers —
the page and MCP — cannot drift into answering different questions; both go
through the same code, the way ADR-0011 already asks every application
service to.

While in the file, `list_media`'s description was corrected. It said the
tool lists files "no draft references," which stopped being true once
ADR-0021 made the `unused` filter count git references too.

**An unknown id makes `references` throw**, the same `not_found` the rest
of the service throws for a bad id, rather than returning two empty arrays.
Two empty lists is indistinguishable from a real answer of "nothing
references this," and that answer is exactly what the UI reads as
permission to delete. A typo in an id, or a file collected out from under a
still-open panel, must not look like proof of safety.

**The page is a `{ name: "media" }` view**, a grid on the left and a detail
panel on the right, reached from the header beside Browse and Edit.
`MediaLibrary` fetches pages of 24, filtered by All or Unused, with a "Load
more" button over the existing `limit`/`offset`. `MediaDetail` is keyed by
the file's id, so choosing a different file remounts it rather than
reusing it — the previous file's usage answer must not flash on screen
while the new one is still in flight.

**Delete is disabled whenever usage is not a settled, empty answer**: while
the references request is in flight, if it fails, or if anything at all
uses the file. A delete the server refuses because something started using
the file in the meantime does not just show the refusal — it drops the
panel's existing usage answer and re-reads, so the button stays off and the
list below it stops claiming "nothing uses this file" the moment that claim
is known to be wrong. Proving a file unused is deletion's precondition, and
a stale proof is not a proof.

**There is no upload button on this page.** Collection (ADR-0021) deletes
anything unreferenced once `MEDIA_GC_GRACE_DAYS` passes, counting from
whenever the file was last seen referenced. A file uploaded here "for
later" starts that clock immediately and is quietly collected before
anyone gets back to it — an upload button would invite exactly the mistake
the collector exists to clean up. Making it safe would need collection to
exempt "uploaded but not yet placed" files, which is a real feature with
its own bookkeeping — a window during which a file is legitimately
unreferenced without being garbage — not something a button can paper over.
Images still enter only by being pasted or dropped into a post
(ADR-0018); an insert-from-library picker that reuses is a separate spec.

**There are no thumbnails.** `image-size` reads dimensions out of a file's
header; it does not decode or resize images. Generating a thumbnail needs a
native image library, and this repository deliberately keeps native
dependencies out of its build (ADR-0012 makes the same call for tooling
generally). Thumbnails would also mean a second stored object per record,
collection logic taught to delete both instead of one, and a migration
run over every file already uploaded. None of that is a small addition to
this page; it is its own project. The grid instead renders originals,
lazily loaded, sized 24 to a page, with `object-fit: cover` on a fixed
tile. Stated plainly, because it is the real cost of this decision: a
bucket of large originals makes the first page load heavy. That is the
signal to build real thumbnails, and nothing built here needs to be undone
to get there.

## Alternatives Considered

### A bulk "delete all unused" button

- **Pros**: Faster than opening files one at a time when a lot has
  accumulated.
- **Cons**: Collection already does this safely, on its own schedule, with
  a grace period against exactly the races — an in-flight paste, an undo, a
  reopened pull request — that make "unused right now" different from
  "safe to delete." A button that skips the grace period mostly buys a
  faster way to make the same mistake sooner.
- **Why not**: One file at a time, chosen and confirmed by a person, is the
  whole point of putting a human in this loop. Bulk deletion stays out of
  scope.

### Exposing the reference count only, not what references it

- **Pros**: Less to build — no join to `documents`, no path or ref to
  format, no list to render.
- **Cons**: A count of zero permits deletion but says nothing about whether
  the file would be missed, and a nonzero count gives no way to check
  whether the reference is one an editor already knows about and is fine
  losing.
- **Why not**: The design's whole reason for existing is to show where a
  file is used, not just whether it is used. A number a person has to trust
  is a worse version of what this page replaces.

## Consequences

### Positive

- MCP and the browser answer "where is this used?" from the same service
  method, so asking Claude what uses an image returns exactly what the
  page would show.
- Deletion's precondition — proven unused — is enforced the same way
  everywhere it matters: an unknown id, a failed request, and an in-flight
  request are all "not yet proven," and all disable the button, rather than
  each caller inventing its own notion of "safe enough."
- The library needed no new server capability beyond the one method; five
  small tasks (SQL, service and route, MCP tool, browser client, page)
  were enough.

### Negative

- The grid has no thumbnails, so a bucket of large originals is a heavy
  first page load. Lazy loading and small pages make this bearable at
  ordinary blog scale, not solved.
- There is still no way to stage an image before it has somewhere to go.
  An editor drafting a post around three images has to paste all three into
  the draft to keep them alive, rather than uploading them first and
  placing them as the draft comes together.

### Risks

- **A reference count can be stale.** ADR-0021 already accepts this: the
  git half is refreshed by the scanner, not on demand, so a file can show a
  git reference a just-merged branch already removed. This page inherits
  that risk rather than adding to it — it errs toward showing more usage
  than exists, which keeps delete conservative, the safe direction.
- **`get_media_references` exposes draft paths and branch names over
  MCP.** No new class of data reaches it: `list_documents` already returns
  paths, and the MCP token is separate from the browser session.
- **The components have no unit tests.** This repository has no React
  testing library, so `MediaLibrary` and `MediaDetail` were verified by
  hand against a real bucket instead: uploads listing correctly, the
  Unused filter, a used file's delete staying disabled, an unused file
  deleting and disappearing, and paging past 24 files. The two server
  layers underneath them — `references(id)` and the route — are tested
  against a real database, and that coverage stops at the boundary where
  the page begins.
