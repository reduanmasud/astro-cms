# ADR-0003: GitHub API only, no local clone

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

GitHub is the source of truth for published content. The CMS must read files,
create branches and commits, and open pull requests. A local clone needs disk,
a Git binary, credential handling, and fetch/pull state that can drift or
corrupt.

## Decision

All repository access goes through the GitHub REST API: the contents and Git
Data APIs for reading and committing files, the refs API for branches, and the
pulls API for PRs. No local clone. We add one only if a concrete requirement
cannot be met through the API, and record that in a new ADR.

## Alternatives Considered

### Local clone driven by the Git CLI

- **Pros**: Cheap full-tree reads. Familiar Git semantics.
- **Cons**: Persistent disk state, a Git binary in the image, fetch
  scheduling, and recovery from a broken working tree.
- **Why not**: Nothing in v1 needs it.

### Clone on demand, discard after each operation

- **Pros**: No long-lived working tree.
- **Cons**: Slow for large repos. Still needs the Git binary and credentials.
- **Why not**: Same drawbacks, slower.

## Consequences

### Positive

- The CMS is stateless with respect to Git. Nothing to repair on disk.
- One credential (a GitHub token), used over HTTPS.

### Negative

- Subject to GitHub API rate limits.
- Scanning `main` for media references means tree and blob API calls.

### Risks

- Large repositories may make reference scans slow or hit rate limits.
  Mitigation: scan only content directories and cache blob SHAs. Revisit if
  measured.
