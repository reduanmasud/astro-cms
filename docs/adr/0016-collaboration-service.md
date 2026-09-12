# ADR-0016: HocusPocus runs as its own service, reached over JWT and a signed webhook

**Date**: 2026-09-12
**Status**: accepted
**Amends**: [ADR-0001](0001-single-node-process.md) (HocusPocus no longer runs in the CMS process)
**Deciders**: Project maintainers

## Context

[ADR-0001](0001-single-node-process.md) put HocusPocus inside the CMS process.
In practice operators already run a HocusPocus server, and both the browser
and MCP need to reach it — the browser from outside, MCP from inside the
private network. That needs two URLs and a way to authorize connections that
does not depend on the CMS's session cookie.

## Decision

HocusPocus runs as a separate service. The CMS holds four settings:
`HOCUSPOCUS_PUBLIC_URL` (browser), `HOCUSPOCUS_INTERNAL_URL` (server and MCP),
`HOCUSPOCUS_JWT_SECRET`, and `HOCUSPOCUS_WEBHOOK_SECRET`. Collaboration is off
unless all four are set, and the editor then saves over the API as before.

The contract between the two, which any standard HocusPocus deployment can
implement:

- **Authentication.** The CMS signs a short-lived JWT (HS256) whose `aud` is
  the room, `sub` the collaborator, plus their display name. HocusPocus
  verifies it in `onAuthenticate` and refuses a token whose room does not
  match the document. This is room isolation.
- **Webhook.** HocusPocus runs the standard webhook extension against
  `POST /api/collab/webhook`, signing each body with
  `X-Hocuspocus-Signature-256`. The CMS verifies that signature in constant
  time before reading anything.
  - `create`: the CMS answers with no document. The first browser client
    seeds the room from the draft it has already loaded.
  - `change` (debounced): carries the document plus the connection context
    HocusPocus built while authenticating. The CMS turns the Tiptap JSON into
    Markdown, writes it to the draft in SQLite, and credits the collaborator
    named in that context.

The `connect` event is deliberately left out. HocusPocus turns a failed
connect webhook into a refused connection, so with it enabled nobody could
open or rejoin a room while the CMS was restarting — measured, not assumed.
Without it, editing survives a CMS outage and saves resume afterwards. The CMS
still answers the event if a deployment sends it.

SQLite stays the durable store, the CMS stays its only writer, and nothing in
this path touches GitHub.

`apps/collab` is this contract as runnable code: Docker Compose uses it for
development, and it documents what a production server must do.

## Alternatives Considered

### Keep HocusPocus in the CMS process (ADR-0001)

- **Pros**: One process, no new secrets.
- **Cons**: Cannot use a HocusPocus server the operator already runs, and
  gives no separate address for MCP.
- **Why not**: The deployment reality decides this one.

### Hydrate rooms from the `create` webhook

- **Pros**: A room could open without a browser, which future MCP work wants.
- **Cons**: The extension rebuilds the document with its own transformer,
  whose default schema is StarterKit. Tables and protected MDX blocks would be
  dropped unless the HocusPocus deployment installs our editor extensions.
- **Why not**: Losing content is worse than a room that waits for its first
  client. Revisit when MCP needs headless rooms, with its own ADR.

### Let the collaboration service write SQLite directly

- **Pros**: No webhook.
- **Cons**: Two processes writing one database file, and the storage rules
  would have to be duplicated.
- **Why not**: The CMS owns its database.

## Consequences

### Positive

- Works with an existing HocusPocus deployment; only two shared secrets.
- A leaked browser token opens one room, for fifteen minutes.
- Drafts stay durable in SQLite even if the collaboration server restarts.

### Negative

- One more service to run, and a second pair of secrets to rotate.
- Saving now happens on a debounce inside HocusPocus, so the CMS sees changes
  slightly later than the old direct autosave.

### Risks

- A room with no browser client (MCP only) starts empty. Mitigation: MCP will
  read and write drafts through the API until headless hydration exists.
- Because `connect` is unused, a room can be opened for a draft that has since
  been deleted; the save then fails with 404 and the text stays in the room.
  Mitigation: the editor only opens rooms for drafts it just loaded.
- Webhook delivery could fail while editing continues. Mitigation: the CMS
  answers non-2xx so HocusPocus logs it, the room keeps the newest text, and
  the next change retries the save.
