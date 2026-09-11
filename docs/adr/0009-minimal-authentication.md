# ADR-0009: Shared password sessions for browsers, static token for MCP

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

The CMS serves a small, trusted group editing one repository. Accounts, OAuth,
and roles would add much more code than the rest of the auth surface. Browsers
and MCP clients authenticate differently: browsers can hold cookies, MCP
clients usually send a static header.

## Decision

Browsers log in with a shared `CMS_PASSWORD`. The server compares passwords in
constant time, creates a random session token, stores only its SHA-256 hash in
SQLite, and sets the token as an `HttpOnly`, `SameSite=Lax` cookie signed with
`SESSION_SECRET` (HMAC-SHA256). Rotating `SESSION_SECRET` signs everyone out.
Neither secret is ever sent to the browser.

After logging in, the user chooses a display name. It is stored as a
**collaborator** (`id`, `name`, `created_at`, `last_seen_at`) and linked to the
session. Choosing a name that already exists (case-insensitive) reuses that
collaborator, so one person keeps one identity across browsers. There are no
user accounts, emails, roles, or permissions. The display name is a label,
not a security boundary.

Every `/api` route requires a session except an explicit allowlist: health,
login, and logout. HocusPocus authenticates with the same cookie. MCP clients
send `Authorization: Bearer <MCP_TOKEN>`, a separate secret from the
environment.

## Alternatives Considered

### GitHub OAuth

- **Pros**: Real identities. Could reuse repository permissions.
- **Cons**: OAuth app setup, callback URLs, token storage, user tables.
- **Why not**: Out of scope by design.

### Per-user passwords

- **Pros**: Revoke one person at a time.
- **Cons**: User management UI and storage.
- **Why not**: Teams and accounts are non-goals.

### MCP using the CMS password

- **Pros**: One secret.
- **Cons**: Rotating one interface's secret breaks the other. Puts the human
  login secret in agent configs.
- **Why not**: Separate secrets keep a leaked MCP config from exposing the web login.

## Consequences

### Positive

- Very little auth code to audit.
- Changing `CMS_PASSWORD` or `MCP_TOKEN` and restarting revokes access for new
  logins; changing `SESSION_SECRET` also ends existing sessions.
- Collaborator identity persists, so presence and commit attribution can use a
  stable `id` rather than a free-text name.

### Negative

- No per-person revocation or audit. Display names can be spoofed.

### Risks

- Password guessing. Mitigation: minimum length at startup, a login rate limit,
  and CSRF protection on state-changing routes.
