# ADR-0002: SQLite with better-sqlite3 and plain SQL, no ORM

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

The CMS stores unpublished state: sessions, drafts (Yjs document state),
branch/PR tracking, and media metadata. Data volume is small and there is one
writer process ([ADR-0001](0001-single-node-process.md)). Self-hosters should
not have to run a database server.

## Decision

We use SQLite through `better-sqlite3`, with hand-written SQL. The schema is
defined by an ordered list of migrations in `apps/server/src/db/migrations.ts`, and
the applied version is tracked with `PRAGMA user_version`. WAL mode is on.
Tables are added only when the feature that needs them lands.

## Alternatives Considered

### PostgreSQL

- **Pros**: Concurrent writers, rich types.
- **Cons**: A second service to run, back up, and configure.
- **Why not**: The workload is single-process and small.

### An ORM or query builder (Prisma, Drizzle, Kysely)

- **Pros**: Typed queries, generated migrations.
- **Cons**: Extra concepts, build steps, and code generation for contributors.
- **Why not**: A handful of tables with simple queries does not need one.

### Node's built-in `node:sqlite`

- **Pros**: No native dependency.
- **Cons**: Still marked experimental / release candidate in current Node LTS.
- **Why not**: Revisit once it is stable. The adapter is small, so switching is cheap.

## Consequences

### Positive

- Backups are a file copy. No database server.
- Synchronous API keeps service code simple.

### Negative

- `better-sqlite3` is a native module. The Docker image must match the
  platform it was installed on.
- Queries are not type-checked against the schema.

### Risks

- Long synchronous queries block the event loop. Mitigation: keep queries
  indexed and small. The data set is small by design.
