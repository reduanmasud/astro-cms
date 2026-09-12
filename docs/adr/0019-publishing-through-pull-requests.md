# ADR-0019: Publishing through pull requests, one branch per content item

**Date**: 2026-09-12
**Status**: accepted
**Implements**: [ADR-0004](0004-one-branch-per-content-item.md), [ADR-0005](0005-drift-detection.md)
**Deciders**: Project maintainers

## Context

Drafts have lived only in SQLite until now: the CMS could read the
repository but never write to it. Publishing is the step that closes the
loop, and it is the one place where a mistake changes someone's repository.

[ADR-0004](0004-one-branch-per-content-item.md) already settled that one
content item gets one branch and one pull request, and
[ADR-0005](0005-drift-detection.md) that a draft records the base commit it
started from. This decision covers how publishing uses them.

## Decision

**Pull requests only.** Publishing commits to a `cms/` branch and opens a
pull request. The CMS never writes the base branch. The PRD sketches an
optional `PUBLISH_MODE=direct`; it is not built, because a second code path
that bypasses review is not needed yet.

**The branch is `cms/<collection>/<slug>`.** Not `cms/<slug>`: two
collections can hold the same slug, and a shared branch would give one file
two competing pull requests. Not the PRD's `cms/<person>/<id>` either: a
per-person branch splits one file across two pull requests, which is what
[ADR-0004](0004-one-branch-per-content-item.md) exists to prevent.

**Publishing again reuses the branch and the pull request.** A second
publish adds a commit; it never opens a second pull request.

**Drift stops a publish before any write.** If the base branch moved at all —
not only if this file changed — publishing stops and the CMS shows the file
as it stands on the base branch. Re-sync moves the draft's baseline pointer
and nothing else; reconciling the text is the person's job.

**Pull request status is checked on demand,** when a document is opened with
`?refresh=true`. Merged becomes `published`; closed-but-unmerged falls back
to `draft`.

## Alternatives Considered

### Commit straight to the base branch

- **Pros**: One step, no review friction, pleasant for a solo project.
- **Cons**: The CMS gains the ability to write the branch every safeguard so
  far has kept it away from, and there is no reviewable artefact.
- **Why not**: Not needed yet. It stays available as a later mode.

### Narrow drift to "this file changed"

- **Pros**: Far less friction. An unrelated commit would not block publishing.
- **Cons**: The CMS would publish on top of a repository state nobody looked
  at, which is the situation drift detection exists to surface.
- **Why not**: This project chose the strict rule deliberately. It is one
  line to narrow if it proves unworkable.

### Webhooks or background polling for pull request status

- **Pros**: Status is fresh without anyone looking.
- **Cons**: Webhooks need the CMS to be publicly reachable with a verified
  endpoint; polling adds a scheduler to a single-process app and spends API
  calls continuously.
- **Why not**: A CMS with a handful of open pull requests can ask when asked.
  [PRD §44](../../README.md) lists webhooks as future-only.

## Consequences

### Positive

- Published content is always reviewable before it reaches the site.
- One file has one branch and one pull request, however many times it is
  published.
- A draft can never quietly overwrite work that landed while it was open.

### Negative

- Publishing is blocked by any commit to the base branch until someone
  re-syncs, which on a busy repository will feel blunt.
- After a merge the draft's baseline is deliberately not advanced, so the
  next publish reports drift once more.

### Risks

- Drift is checked immediately before the write, so the window is small but
  not zero: GitHub could receive a push in between. `commit` is
  fast-forward-only, so the worst case is a rejected push, never a silent
  overwrite.
- A merged pull request can leave its branch behind, and `saveToBranch`
  refuses a branch with no open pull request because committing there would
  reopen merged history. Mitigation: enable "automatically delete head
  branches" on the repository. Adding `deleteBranch` to the GitHub client is
  the follow-up if that proves annoying.
