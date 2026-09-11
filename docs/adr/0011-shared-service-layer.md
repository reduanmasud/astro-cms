# ADR-0011: Web UI and MCP share one service layer

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

MCP is a first-class interface, not an add-on. If HTTP routes and MCP tools
each implement their own logic, the two will drift: a rule enforced in the UI
(e.g. drift detection before publish) could be skipped through MCP.

## Decision

All business rules live in service modules under `apps/server/src/services/`.
Hono routes, HocusPocus hooks, and MCP tools are thin interfaces: they
authenticate the caller, validate input, call a service, and format the
result. Only services touch SQLite, GitHub, or S3. Services are plain functions
or small objects that receive their dependencies explicitly, with no DI
framework.

## Alternatives Considered

### MCP calls the CMS's own HTTP API

- **Pros**: MCP could run as a separate process.
- **Cons**: Extra HTTP hop, duplicated auth, and error mapping.
- **Why not**: Same process already ([ADR-0001](0001-single-node-process.md)).

### Logic in route handlers

- **Pros**: Less indirection at first.
- **Cons**: MCP would have to duplicate it.
- **Why not**: Breaks the "same services" requirement.

## Consequences

### Positive

- One place to test each business rule.
- A new interface is only a thin adapter.

### Negative

- Slightly more files than putting logic in handlers.

### Risks

- Logic creeping into interfaces. Mitigation: code review checks that routes
  and tools contain no storage access.
