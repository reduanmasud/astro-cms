# Media library: seeing what the bucket holds, and what still needs it

**Date**: 2026-09-16
**Status**: approved, not yet implemented
**Implements**: PRD §20
**Builds on**: [ADR-0017](../../adr/0017-media-storage.md), [ADR-0021](../../adr/0021-media-collection.md)

## Goal

See every stored file, find the ones nothing references any more, and
delete one when you are sure.

The media subsystem is finished and invisible. Files upload, deduplicate by
content hash, accumulate references from drafts and from the repository, and
get collected once they go unreferenced past a grace period. None of it
reaches the web interface, where the only media operation is pasting an image
into a post.

## Decisions

Settled before design, and not revisited here:

- **Two pieces, library first.** This spec covers the library page. An
  insert-from-library picker for the editor reuses its grid and list and
  gets its own spec afterwards.
- **Show where a file is used**, not just how many places use it.
- **Delete one file at a time.** No bulk sweep.
- **No uploading from the library.** See below.
- **No thumbnails.** Originals, lazily loaded.

## The one server change

Everything the page needs exists except the answer to "where is this used?".
`MediaRecord.referenceCount` is a number; the two tables behind it know the
places.

```
GET /api/media/:id/references
  → { drafts: [{ documentId, collection, path }],
      git:    [{ ref, path }] }
```

It is backed by a `references(id)` method on the media service rather than a
query in the route, because the UI and MCP must go through the same
application service. MCP gets `get_media_references` alongside the existing
`list_media`, `get_media` and `upload_media`, so asking Claude what uses an
image returns what the page shows.

The drafts side joins `media_references` to `documents` so a caller sees
`blog/my-post.mdx` rather than a document id. The git side reads
`media_git_references` directly, which already stores a ref and a path.

While in the file: `list_media`'s description says it lists files "no draft
references". Since [ADR-0021](../../adr/0021-media-collection.md) the filter
counts git references too, so the description is wrong and gets corrected.

Nothing else on the server changes. Listing, the `unused=true` filter,
pagination, and the reference-checking delete are built and tested.

## The page

A `{ name: "media" }` view beside `browse` and `edit`, reached from the
header.

```
apps/web/src/media/
  MediaLibrary.tsx   The grid, the filter, paging.
  MediaDetail.tsx    The selected file: metadata, usage, delete.
```

plus `listMedia`, `getMediaReferences` and `deleteMedia` in `api.ts`.

**The grid** is thumbnails, newest first, filtered by All or Unused — the
latter is `?unused=true`. Paging is a "Load more" button over the existing
`limit`/`offset`, which suits a grid better than prev/next.

**The detail panel** shows a larger preview, the filename, dimensions, size,
who uploaded it and when, then its usage: either the places that reference
it, or that nothing does and since when. Delete sits below, enabled only at
zero references. When it is disabled, the list above it is the reason — no
separate explanation is needed.

## Why there is no upload here

It is the obvious feature for something called a media library, and it is a
trap.

Collection deletes anything unreferenced once the grace period passes. An
image uploaded "for later" and not placed in a post within
`MEDIA_GC_GRACE_DAYS` is collected. An upload button on this page would
invite exactly the thing the system is built to undo, and the file would
disappear without anybody doing anything wrong.

This is not an asset store. It is a view onto what the content references,
and a file earns its place by being used. Making upload safe here would mean
an exemption in collection for "uploaded but not yet placed" — a real feature
with real bookkeeping, not a button. Images still enter by being pasted or
dropped into a post, and the picker will be how they are reused.

## Why there are no thumbnails

There is no image-processing capability in the project. `image-size` reads
dimensions out of file headers; it cannot resize. Generating thumbnails means
a native dependency such as `sharp` — in a repository that deliberately keeps
native builds off — a second object per record, collection changes to delete
both, and a migration for every existing upload.

So the grid renders originals, scaled by CSS:

- `loading="lazy"`, so only visible tiles fetch.
- Page size 24.
- `width` and `height` from the stored dimensions, so the grid does not
  reflow as images arrive.
- `object-fit: cover` on a fixed tile, so a tall image does not distort its
  row.

Objects are served `public, max-age=31536000, immutable`, so this is a
first-load cost per image per browser, not a per-visit one. At realistic blog
image sizes a page is 5–20MB once. **Its failure mode, stated plainly: a
bucket of 10MB originals makes the first page load heavy.** That is the
signal to build real thumbnails, and nothing here has to be undone for it.

## Errors

| Situation                           | What happens                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Media storage not configured        | The view says so and offers nothing else                                             |
| The list request fails              | The error, and a retry                                                               |
| The references request fails        | The panel shows metadata; usage says it could not be read, and delete stays disabled |
| Delete refused because it is in use | The refusal, and the usage list refreshes                                            |
| Delete fails for any other reason   | The error; the file stays in the grid                                                |
| An object is missing from storage   | The tile shows a broken-image placeholder rather than an empty box                   |

A references request that fails must leave delete disabled. Deletion is the
one irreversible action here, and proving a file unused is its precondition.

## Testing

Server, against a real database:

- `references(id)` returns draft references with their collection and path,
  and git references with their ref and path.
- A file with no references returns two empty lists.
- Deleting a document removes its draft references from the answer.
- The route returns 404 for an unknown id, and refuses when storage is off.

Browser, by hand, because these components have no unit tests:

- The grid lists real uploads and the Unused filter narrows it.
- A file used by a draft shows that draft, and its delete is disabled.
- An unused file deletes, and disappears from the grid.
- A bucket with more than 24 files pages correctly.

## Out of scope

The insert-from-library picker. Renaming or replacing a file — content
addressing means a changed file is a different object. Folders, tags, or
any organisation beyond newest-first and the unused filter. Bulk deletion.
A countdown to collection, which would need the grace period exposed to the
browser.

## Risks

- **The grid downloads full-size originals.** Mitigated by lazy loading and
  a small page, and honest about where that stops being enough.
- **A reference count can be stale** between collection sweeps: the git half
  is refreshed by the scanner, not on demand. A file may show a git reference
  that a just-merged branch removed. It errs toward showing more usage than
  exists, which keeps delete conservative — the safe direction.
- **`get_media_references` exposes draft paths and branch names over MCP.**
  No new class of data: `list_documents` already returns paths, and the
  MCP token is separate from the browser session.
