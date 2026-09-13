# MCP: the same CMS, spoken to by a model

**Date**: 2026-09-13
**Status**: approved, not yet implemented
**Implements**: [ADR-0001](../../adr/0001-single-node-process.md), [ADR-0011](../../adr/0011-shared-service-layer.md)

## Goal

Expose the CMS's own operations to an MCP client so a model can read
collections, draft content, upload media, and publish — using exactly the
services the web UI uses, never a parallel implementation.

## Decisions

Settled before design, and not revisited here:

- **Tools only.** No MCP resources, prompts, sampling, or elicitation yet.
- **One process.** The MCP endpoint is mounted on the existing Hono app
  ([ADR-0001](../../adr/0001-single-node-process.md)), not a second server.
- **Its own token.** MCP authenticates with a static `MCP_TOKEN`, entirely
  separate from the browser's shared password and session cookie.
- **The same services.** A tool validates, calls a service, and formats the
  result. Business logic lives in services
  ([ADR-0011](../../adr/0011-shared-service-layer.md)).
- **Media arrives by URL, never base64.** The server fetches the bytes.

## Shape

```
MCP client ──HTTP + MCP_TOKEN──► POST /api/mcp ──► mcp/server.ts
                                                        │
                                   the same services the routes use:
                          project · documents · drafts · publish · media · repository
```

`@modelcontextprotocol/server` 2.0.0 with `@modelcontextprotocol/hono`
2.0.0. `createMcpHandler` returns a web-standard handler, so mounting is one
line: `app.all("/api/mcp", (c) => handler.fetch(c.req.raw))`. Verified
against Node 24 and Hono 4.13: `initialize`, `tools/list` and `tools/call`
all answer, framed as server-sent events with HTTP 200.

Input schemas use `fromJsonSchema()` — plain JSON Schema objects, so the CMS
writes no Zod of its own. Zod still arrives as a transitive dependency of
`@modelcontextprotocol/server`; that is the SDK's choice, not ours.

## Authentication

`MCP_TOKEN` in the environment switches MCP on. Absent, `/api/mcp` answers
404 `mcp_disabled`, the way media and collaboration do when unconfigured.

Present, every request must carry `Authorization: Bearer <MCP_TOKEN>`.
A missing or wrong token is 401 `unauthenticated`. The comparison is
constant-time, as the password check already is.

The session middleware skips `/api/mcp` entirely: MCP never sees a cookie,
and a browser session never grants MCP access. Two doors, two keys.

## Identity

MCP has no display name to offer, but every write records who made it. On
first use the CMS ensures one collaborator row named **MCP** exists and
attributes MCP's changes to it, so `created_by` and `updated_by` read the
same way they do for a person.

## Tools

Reading:

| Tool                    | Service call                       |
| ----------------------- | ---------------------------------- |
| `get_project`           | `project.discover()`               |
| `get_repository`        | `repository.getStatus()`           |
| `list_collections`      | `project.discover()` → collections |
| `get_collection_schema` | `project.getCollection(name)`      |
| `list_documents`        | `documents.list(options)`          |
| `search_documents`      | `documents.search(text, options)`  |
| `get_document`          | `documents.get(id)`                |
| `list_media`            | `media.list(options)`              |
| `get_media`             | `media.get(id)`                    |
| `get_publish_status`    | `publish.refresh(id)`              |
| `get_pull_request`      | `repository.getPullRequest(n)`     |

Writing:

| Tool               | Service call                         |
| ------------------ | ------------------------------------ |
| `create_document`  | `drafts.open({ collection, path })`  |
| `update_document`  | `documents.update(id, changes)`      |
| `delete_document`  | `documents.delete(id)`               |
| `upload_media`     | fetch the URL, then `media.upload()` |
| `delete_media`     | `media.delete(id)`                   |
| `publish_document` | `publish.publish(id, mcpActor)`      |
| `resync_document`  | `publish.resync(id)`                 |

`resync_document` is not in the PRD's list, but publishing stops on drift and
a model would otherwise have no way through it. `create_pull_request` is
deliberately absent: publishing already opens the pull request, and a second
path invites the duplicate PRs [ADR-0004](../../adr/0004-one-branch-per-content-item.md)
forbids.

Every tool returns JSON as a text content block. Service errors
(`DocumentError`, `MediaError`, `PublishError`, `GitHubError`) become a tool
result with `isError: true` and the service's own message — a model can read
"the base branch moved since this draft started" and act on it.

## upload_media, and the SSRF it invites

The tool takes `url` and an optional `filename`. The server fetches the
bytes and hands them to the same `media.upload()` a browser paste uses, so
MIME sniffing, the 10 MB cap, SHA-256 dedup, and metadata are unchanged.

Fetching a caller-supplied URL from inside the server is a request-forgery
hazard: a client could aim it at `169.254.169.254`, or at something reachable
only from the CMS's network, and read the response through the CMS. So:

- `http:` and `https:` only — no `file:`, `gopher:`, or anything else.
- Resolve the hostname first and refuse loopback, private, link-local,
  unique-local, multicast, and unspecified addresses.
- `redirect: "manual"` — a 3xx is refused rather than followed, so a public
  URL cannot bounce to a private one.
- A 10-second timeout, and reading stops at the size cap.

**Residual risk, stated plainly:** the address is checked before the fetch,
so a hostname that resolves differently a moment later (DNS rebinding) could
still slip past. Closing that needs an agent that pins the resolved address
for the connection. For a self-hosted CMS whose MCP token its operator holds,
the check above is proportionate; the stricter fix is a follow-up if MCP is
ever exposed to callers the operator does not trust.

## Errors

| Situation            | Result                                          |
| -------------------- | ----------------------------------------------- |
| No `MCP_TOKEN` set   | HTTP 404 `mcp_disabled`                         |
| Missing/wrong token  | HTTP 401 `unauthenticated`                      |
| Unknown document     | tool result, `isError: true`, "No document…"    |
| Drift on publish     | tool result, `isError: true`, the drift message |
| Media storage is off | tool result, `isError: true`, "not configured"  |

Transport-level failures are HTTP; everything a model can act on is a tool
result, because a JSON-RPC error is harder for a model to reason about than
a sentence.

## Testing

Against the existing fakes — no real GitHub, no real bucket:

- `tools/list` advertises every tool, each with a JSON Schema.
- A round trip: `create_document` → `update_document` → `get_document`
  returns the written source.
- `publish_document` opens a pull request through the fake GitHub client;
  publishing twice reuses it.
- `publish_document` on a drifted draft returns `isError` with the drift
  message, and the fake records no writes.
- `upload_media` stores a served image and returns a public URL.
- `upload_media` refuses `http://127.0.0.1/…`, a private address, and a
  `file://` URL.
- Without `MCP_TOKEN`: 404. With a wrong token: 401.
- A document created through MCP has `createdBy` named "MCP".
- Responses are SSE-framed, so assertions parse `data:` lines rather than
  the raw body.

## Out of scope

Resources, prompts, sampling, elicitation, stdio transport, per-client
tokens, and rate limiting on MCP. Media garbage collection, the media
library UI, and schema-driven frontmatter fields are separate work.

## Risks

- **MCP v2 is new.** The packages are days old as a stable release. The
  smoke test passed on this exact stack, but fewer clients have been tested
  against v2 than against the 1.x line. If a client cannot connect, the
  fallback is the 1.x SDK with a Node adapter.
- **A static token is all-or-nothing.** Anyone holding `MCP_TOKEN` can do
  everything MCP can do, including publish. That matches the CMS's existing
  posture — one shared password for people — but it is worth knowing.
- **Zod is now in the tree.** Transitively, through the SDK. The CMS's own
  code declares schemas as plain JSON Schema.
