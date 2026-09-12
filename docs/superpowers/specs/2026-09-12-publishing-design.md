# Publishing: draft → CMS branch → pull request

**Date**: 2026-09-12
**Status**: approved, not yet implemented
**Implements**: [ADR-0004](../../adr/0004-one-branch-per-content-item.md),
[ADR-0005](../../adr/0005-drift-detection.md)

## Goal

Turn a SQLite draft into a commit on a `cms/` branch and an open pull
request, and keep publishing the same draft updating that same branch and
pull request instead of making new ones.

Drafting still never touches GitHub. Publishing is the only thing that does.

## Decisions

Settled before design, and not revisited here:

- **Pull requests only.** No `PUBLISH_MODE=direct` in this phase. The CMS
  never writes the base branch.
- **Status on demand.** The CMS asks GitHub about a pull request when someone
  opens the document or the collection list. No scheduler, no webhooks.
- **Drift blocks.** If the base branch moved at all, publishing stops. The CMS
  shows the file as it stands on the base branch and offers an explicit
  re-sync. It never merges text automatically.
- **One item, one branch, one pull request** ([ADR-0004](../../adr/0004-one-branch-per-content-item.md)).

## Shape

A `publish` service owns the sequence. `documents` stays SQLite-only and
`repository` stays GitHub-only; `publish` is the single place that knows
both, and the MCP server will later call it rather than reimplementing it.

```
routes/documents.ts ──► services/publish.ts ──► services/repository.ts ──► GitHub
                               │
                               └──► db/document-repository.ts (publication columns)
```

## The publish sequence

```
publish(documentId, actor)
  1. load the draft
  2. drift check: draft.baseCommitSha vs repository.getBaseHead()
        differ → stop with a drift error, nothing written to GitHub
  3. branch = cms/<collection>/<slug>
  4. repository.saveToBranch({ branch, message, changes, pullRequest })
  5. record branch, pull request number and url, published commit, published
     time; status → in_review
```

Step 4 already exists and needs no changes. It creates the branch from the
base head when absent, commits, reuses an open pull request, and creates one
only when the branch has none.

**Branch name.** `cms/<collection>/<slug>`, not `cms/<slug>`: two collections
can hold the same slug (`blog/hello` and `projects/hello`), and a shared
branch would give one file two competing pull requests. Not
`cms/<person>/<id>` either, which the PRD sketches — a per-person branch
splits one file across two pull requests, which is exactly what
[ADR-0004](../../adr/0004-one-branch-per-content-item.md) forbids.

**Commit message.** `Add <path>` on the first publish to a branch, otherwise
`Update <path>`.

**Pull request.** Title `CMS: <collection>/<slug>`. Body names the file, the
collection, and who published it, and says the CMS manages the branch.

## Drift and re-sync

`baseCommitSha` is stamped when a draft is created and never moves on its own.
Publishing compares it with the current base head and stops on any
difference — not only when this file changed. That is the rule this project
chose, and it is deliberately strict: it is better to ask than to publish on
top of something unseen.

```
GET  /api/documents/:id/drift   → { drifted, baseCommitSha, headSha, baseContent }
POST /api/documents/:id/resync  → baseCommitSha = current head
```

`baseContent` is the file as it stands on the base branch, or null when the
file does not exist there yet, so the UI can show it beside the draft.

Re-sync moves the baseline pointer and nothing else. It never edits the
draft. Reconciling the text is the person's job; the CMS will not guess.

**A draft with no baseline.** When `baseCommitSha` is null there is nothing to
violate, so publishing stamps it with the current head and proceeds. This is
the case for a file that does not exist on the base branch yet.

## Status

`draft` → `in_review` when a pull request is open → `published` when it
merges.

Refresh happens on demand, when a document or list is opened with
`?refresh=true` and the document has a pull request number:

| GitHub says        | CMS does                                                            |
| ------------------ | ------------------------------------------------------------------- |
| open               | stays `in_review`                                                   |
| merged             | `published`                                                         |
| closed, not merged | back to `draft`; the branch record is kept so the error can name it |

**Publication fields.** `publishedCommitSha` and `publishedAt` record what the
CMS pushed and when — not the merge. Status carries where the change is in
review. Keeping those separate avoids a field that means two things.

**After a merge the baseline does not advance.** The next publish will see
drift and ask for a re-sync. That follows from the strict drift rule: other
commits may have landed alongside the merge, and silently adopting them would
hide exactly what the rule exists to surface.

**After a merge the branch may linger.** `saveToBranch` refuses a branch that
exists with no open pull request, because committing to it would reopen
merged history. GitHub's "automatically delete head branches" setting makes
this disappear; without it, the CMS asks the operator to delete the branch.
The README will say so. Adding `deleteBranch` to the GitHub client is the
follow-up if this proves annoying — deliberately not in this phase.

## API

```
POST /api/documents/:id/publish   200 { pullRequest, commitSha, createdBranch, createdPullRequest }
                                  409 drift
                                  409 branch exists without an open pull request
                                  502 GitHub unreachable
GET  /api/documents/:id/drift     200 { drifted, baseCommitSha, headSha, baseContent }
POST /api/documents/:id/resync    200 { baseCommitSha }
```

Publishing requires a display name, like every other write.

## Data model

No migration. The columns exist; nothing writes them yet. Two repository
methods are new:

- `setPublication(id, { branch, pullRequestNumber, pullRequestUrl, publishedCommitSha, publishedAt, status })`
- `setBaseCommit(id, sha)`

Neither bumps `revision`: publishing records where a draft went, it does not
change the draft, and bumping would break an editor that holds a revision.

## UI

A **Publish** button in the editor header, beside "Save now". It saves first —
publishing a stale draft would publish something the person is not looking
at — then publishes, then shows the pull request link.

On a drift error the header swaps to a conflict panel: the base branch's
version of the file beside the draft, and one **Re-sync** button. No merge
button, because there is no automatic merge.

## Testing

Against `createFakeGitHubClient`, so no real repository is touched:

- publishing creates the branch and the pull request
- publishing again reuses both and adds a second commit — no second pull request
- drift stops the publish, and the fake records **zero** writes
- a merged pull request moves the draft to `published`
- a closed, unmerged pull request is refused with a message naming the branch
- re-sync moves the baseline and leaves the draft's source untouched
- publishing without a display name is refused

Then one real publish against the configured repository, producing one pull
request that can be closed afterwards. The fake proves the logic; only GitHub
proves the integration. Publishing opens a pull request and never merges, so
this is safe to run against the live repository.

## Out of scope

Direct-to-main publishing, webhooks, background polling, branch deletion,
scheduled media garbage collection, and publishing more than one document at
a time. Media reference counting still reads drafts only; extending it to
pull requests and `main` belongs with the garbage collector
([ADR-0008](../../adr/0008-media-storage-and-gc.md)), not here.

## Risks

- **Drift is checked immediately before the write, not at page load**, so the
  window is as small as the API allows. It cannot be zero: GitHub could
  receive a push in between. `commit` is fast-forward-only, so the worst case
  is a rejected push, never a silent overwrite.
- **The strict drift rule will feel blunt** on a busy base branch: any commit
  by anyone blocks publishing until a re-sync. That is the chosen rule.
  Narrowing it to "this file changed" is a one-line change if it proves
  unworkable in practice.
