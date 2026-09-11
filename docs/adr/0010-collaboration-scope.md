# ADR-0010: Collaboration is live editing, presence, and cursors only

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

Tiptap + Yjs + HocusPocus makes many collaboration features possible. Each one
(comments, suggestions, offline sync, locking) brings its own data model, UI,
and edge cases. Keeping the project small means drawing a clear line.

## Decision

v1 collaboration is limited to live co-editing, presence, and cursors through
Tiptap, Yjs, and HocusPocus, with Yjs state persisted in SQLite. No offline
mode, comments, tracked changes, document locking, or collaborative Git
workflow.

## Alternatives Considered

### Single-editor locking instead of CRDTs

- **Pros**: Simpler server.
- **Cons**: Editors block each other. Stale locks.
- **Why not**: Live collaboration is a core requirement.

### Full feature set (comments, suggestions, offline)

- **Pros**: Closer to Google Docs.
- **Cons**: Much more scope and storage.
- **Why not**: Not needed to prove the product.

## Consequences

### Positive

- A small, well-trodden integration path.
- Clear answer for feature requests in this area.

### Negative

- Review discussions happen on the GitHub PR, not in the CMS.

### Risks

- Contributors may add these features piecemeal. Mitigation: this ADR must be
  superseded first.
