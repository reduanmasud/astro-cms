# ADR-0004: One content item, one branch, one pull request

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

Publishing turns a draft into a GitHub pull request. We have to decide how
drafts map to branches. The choice affects how reviewers see changes and how
much Git state the CMS tracks.

## Decision

Each content item (identified by its repository file path) has at most one CMS
branch and one open PR. Publishing the same item again adds a commit to the
same branch and so updates the same PR. There are no branches per save or per
collaborator. The branch name is derived deterministically from the file path
under a `cms/` prefix.

## Alternatives Considered

### Branch per publish

- **Pros**: Each publish is reviewed on its own.
- **Cons**: PRs pile up for the same file and conflict with each other.
- **Why not**: Reviewers want one place per item.

### One branch batching many items

- **Pros**: Fewer PRs for a multi-page change.
- **Cons**: One unfinished item blocks the rest. Harder to map UI state to PRs.
- **Why not**: More coordination state than v1 needs.

## Consequences

### Positive

- A simple, stable mapping: path → branch → PR.
- Reviewers see the full history of an item's CMS edits in one PR.

### Negative

- A change spanning several items produces several PRs.

### Risks

- A PR may be closed or merged, or its branch deleted, on GitHub. Mitigation:
  check PR and branch state before each publish, and start a new branch/PR if
  the previous one is gone.
