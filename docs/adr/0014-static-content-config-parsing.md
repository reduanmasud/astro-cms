# ADR-0014: Parse content.config.ts with @babel/parser, never execute it

**Date**: 2026-09-12
**Status**: accepted
**Deciders**: Project maintainers

## Context

[ADR-0007](0007-frontmatter-schema-inference.md) settled that collections and
their fields come from the Astro project's own `src/content.config.ts`, read
by static analysis. That needs a parser that understands TypeScript, because
the file is TypeScript and may use `satisfies`, type annotations, and imports.

## Decision

We parse the file with `@babel/parser` (TypeScript plugin) and walk the
syntax tree: the exported `collections` object, each `defineCollection` call,
its loader (`glob`, `file`, or the legacy `type`), and its Zod schema. Zod
chains such as `z.string().url().optional()` are read from the inside out.

Anything not recognised is reported honestly: a field becomes `unknown`, or
the whole schema becomes `{ inferred: false, reason }`, so the UI falls back
to editing raw frontmatter. The file is never executed.

## Alternatives Considered

### Execute the config in a sandbox

- **Pros**: Exact schemas, including computed ones.
- **Cons**: Runs repository code on the CMS server, and needs Astro's imports
  (`astro:content`, `astro/loaders`) to resolve.
- **Why not**: Security, and it would drag Astro into the server.

### TypeScript's own compiler API

- **Pros**: No extra dependency if TypeScript is already present.
- **Cons**: TypeScript 7 ships no JavaScript compiler API
  ([ADR-0012](0012-pnpm-workspaces-and-tooling.md)), so this would mean a
  second TypeScript just for parsing.
- **Why not**: `@babel/parser` is one small dependency that does the job.

### Regular expressions

- **Pros**: No dependency.
- **Cons**: Breaks on nesting, comments, and multi-line schemas.
- **Why not**: Too fragile for real configs.

## Consequences

### Positive

- Reading a config cannot execute anything, whatever the repository contains.
- Unknown syntax degrades to "not inferred" instead of a wrong guess.

### Negative

- Schemas built by a function call or spread across modules are not inferred.
- Support for new Zod or loader patterns means extending the parser.

### Risks

- Astro may change the config format. Mitigation: the parser is one file with
  direct tests, and every unsupported shape already has a safe fallback.
