# ADR-0013: Drafts are rows in SQLite, behind a repository and a service

**Date**: 2026-09-12
**Status**: accepted
**Deciders**: Project maintainers

## Context

Editing has to survive a browser refresh and a server restart long before
anything is published. Drafts must never reach GitHub by accident, and the
storage code must stay easy to read for contributors.

## Decision

A draft is one row in the `documents` table: id, collection, path, format
(`md` or `mdx`), slug, source, status, creator, updater, timestamps, and the
publication fields (base commit, branch, pull request, published commit). One
path has at most one draft.

The code is split in two:

- `db/document-repository.ts` holds every SQL statement and nothing else.
- `services/documents.ts` holds the rules: validation, ids, timestamps, and
  who changed what. It takes no GitHub client at all, so drafting cannot
  write to the repository.

`services/draft-opener.ts` is the only place that fills a new draft from
GitHub, and it only reads. Every update increases `revision`; a caller may
send `expectedRevision` to have a stale write rejected instead of overwriting.
Search is a `LIKE` over path, slug, and source.

## Alternatives Considered

### One layer of "storage services"

- **Pros**: Fewer files.
- **Cons**: SQL mixed with rules; no place to test either on its own.
- **Why not**: The split is two small files and makes both testable.

### Full-text search (FTS5)

- **Pros**: Ranked results, faster on large sets.
- **Cons**: A virtual table plus triggers to keep it in sync.
- **Why not**: One repository's content is small. Revisit if search gets slow.

### Storing parsed editor JSON instead of Markdown

- **Pros**: No parsing when opening a draft.
- **Cons**: The editor's format becomes the stored format; publishing would
  still have to serialize, and any editor change would migrate the data.
- **Why not**: Markdown is the format GitHub stores, so drafts keep it too.

## Consequences

### Positive

- Drafting cannot change the repository; a test asserts it.
- Losing an update to a second tab is rejected instead of silently applied.

### Negative

- Search does not rank results and scans rows.
- The publication columns sit empty until publishing is built.

### Risks

- Two people editing one draft still overwrite each other between saves.
  Mitigation: live collaboration (Yjs) replaces single-writer saving later;
  the revision check limits the damage until then.
