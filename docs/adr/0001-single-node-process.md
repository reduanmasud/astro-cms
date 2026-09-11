# ADR-0001: One Node.js process hosts HTTP, HocusPocus, and MCP

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

The CMS needs an HTTP API and static frontend, a WebSocket server for
collaborative editing (HocusPocus), and an MCP endpoint. It serves one
repository and a small group of editors. Every extra process adds deployment
steps, inter-process communication, and failure modes for self-hosters.

## Decision

A single Node.js process runs Hono (HTTP API and built frontend), HocusPocus
(attached to the same HTTP server for WebSocket upgrades), and the MCP endpoint.
SQLite is the only durable store. There is no Redis or second service.

## Alternatives Considered

### Separate collaboration server

- **Pros**: HocusPocus can scale and restart independently.
- **Cons**: Needs shared auth, shared persistence, and a second container.
- **Why not**: No real runtime boundary requires it at this scale.

### HocusPocus + Redis for horizontal scaling

- **Pros**: Multiple app instances can share document state.
- **Cons**: Adds Redis and multi-instance coordination.
- **Why not**: One instance per repository is the product's design.

## Consequences

### Positive

- One container, one port, one log stream.
- Services are called in-process from every interface. No RPC layer.

### Negative

- A crash takes down editing, the API, and MCP together.
- Cannot run more than one instance against the same SQLite file.

### Risks

- CPU-heavy work (e.g. scanning a large repo for media references) could stall
  the event loop. Mitigation: keep that work batched and bounded, and reconsider
  a worker thread only if it is measured to be a problem.
