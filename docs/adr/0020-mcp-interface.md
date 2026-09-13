# ADR-0020: MCP on the same app, the same services, its own token

**Date**: 2026-09-13
**Status**: accepted
**Implements**: [ADR-0001](0001-single-node-process.md), [ADR-0011](0011-shared-service-layer.md)
**Deciders**: Project maintainers

## Context

The CMS had one interface: a browser. The product calls for a second — a
model should be able to read collections, draft content, add images, and
publish, doing exactly what a person can do and no more.

The risk in a second interface is that it grows its own rules. Two
implementations of "publish" would drift, and the one a model uses would be
the one nobody reviews.

## Decision

**Tools call services, never storage.** Each tool validates its arguments,
calls the same service the HTTP route calls, and formats the result. A tool
holds no business logic ([ADR-0011](0011-shared-service-layer.md)), so
publishing through MCP stops on drift, reuses one branch and one pull request,
and leaves GitHub untouched while drafting — because it is the same code.

**One process.** The MCP server is mounted on the existing Hono app at
`POST /api/mcp` ([ADR-0001](0001-single-node-process.md)), using
`@modelcontextprotocol/server` 2.0.0 and its Hono adapter. No second service.

**Its own door.** MCP authenticates with a static `MCP_TOKEN` carried as a
bearer token, compared as a SHA-256 hash so the check is constant time.
`/api/mcp` is exempt from the session middleware — an MCP client has no
cookie — and from `csrf()`. Unset, the route answers 404, the way media and
collaboration do when unconfigured.

**One fixed identity.** MCP has no display name, so its writes are attributed
to a collaborator row named `MCP`. A model's changes read like anyone else's.

**Media arrives by URL.** `upload_media` takes a public URL; the server
fetches the bytes and hands them to the same `media.upload()` a browser paste
uses. Base64 through JSON-RPC was the alternative and is worse: large,
awkward, and it would bypass nothing.

## Alternatives Considered

### A separate MCP process

- **Pros**: Isolates a new interface from the web app.
- **Cons**: A second process needs its own copy of every service, its own
  database handle, and its own deployment.
- **Why not**: [ADR-0001](0001-single-node-process.md). The CMS is one
  process, and the services are already in memory.

### Reusing the browser session for MCP

- **Pros**: One credential to configure.
- **Cons**: An MCP client has no cookie jar and no password prompt, and a
  browser session would then grant tool access.
- **Why not**: Two audiences, two credentials. A leaked `MCP_TOKEN` does not
  become a browser login, and revoking one does not disturb the other.

### Base64 image bytes in a tool argument

- **Pros**: No outbound request from the server.
- **Cons**: JSON-RPC arguments are a poor transport for megabytes, and the
  model would have to hold the bytes.
- **Why not**: A URL is smaller, and the server-side fetch reuses the
  existing inspection and deduplication.

## Consequences

### Positive

- A model and a person reach GitHub through one reviewed code path.
- Adding a capability to a service exposes it to both interfaces at once.
- MCP can be switched off entirely by leaving `MCP_TOKEN` unset.

### Negative

- Anyone holding `MCP_TOKEN` can do everything MCP can do, including publish.
  That matches the CMS's posture — one shared password for people — but it is
  coarse.
- Zod is now in the dependency tree, as a hard dependency of
  `@modelcontextprotocol/server`. The CMS declares its own schemas as plain
  JSON Schema through `fromJsonSchema`.

### Risks

- **Server-side fetching invites request forgery.** `upload_media` refuses
  anything but http/https, resolves the hostname and rejects loopback,
  private, link-local, unique-local, multicast and CGNAT addresses, refuses
  redirects rather than following them, times out, and caps the size. The
  address is checked before the fetch, so a hostname that resolves differently
  a moment later (DNS rebinding) could still slip past; closing that needs an
  agent that pins the resolved address. Proportionate for a self-hosted CMS
  whose operator holds the token.
- **MCP v2 is new.** The smoke test passed on this stack, but fewer clients
  have been tested against v2 than against the 1.x line. The fallback is the
  1.x SDK with a Node adapter.
- **A typing trap worth remembering.** `registerTool`'s first overload
  declares `OutputArgs` before `InputArgs` with no default, so a handler whose
  return type is not `CallToolResult` makes inference fail, TypeScript falls
  through to the deprecated `ZodRawShape` overload, and the error blames the
  input schema. Tool handlers must be typed `CallToolResult`.
