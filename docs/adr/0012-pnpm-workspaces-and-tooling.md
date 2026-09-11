# ADR-0012: pnpm workspaces, TypeScript 7, and an isolated TypeScript for ESLint

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

The repository holds a server, a web app, and shared tooling, so it needs a
workspace-aware package manager. We use the latest TypeScript (7.x, the native
Go compiler) for type checking. `typescript-eslint`, which powers type-aware
lint rules, needs TypeScript's JavaScript compiler API. TypeScript 7 no longer
ships that API, and `typescript-eslint` supports TypeScript only below 6.1. We
tested this: loading TypeScript 7 into `typescript-eslint` crashes.

## Decision

We use **pnpm 12 workspaces** (`apps/*`, `tooling/*`), pinned through the
`packageManager` field, with shared dependency versions in the
`pnpm-workspace.yaml` catalog. The apps type-check with **TypeScript 7**. The
`tooling/eslint-config` package depends on **TypeScript 6.0** privately. pnpm
resolves peer dependencies per dependent, so `typescript-eslint` and its
helpers see 6.0 while `tsc` in the apps is 7.

pnpm 12 is installed with `npm install --global pnpm@12.4.1`, not Corepack:
the Corepack bundled with Node 24 cannot launch pnpm 12's native binary.

## Alternatives Considered

### npm workspaces

- **Pros**: Ships with Node. Nothing extra to install.
- **Cons**: npm hoists packages whose peer dependency is satisfiable at the
  root. `ts-api-utils` was hoisted next to TypeScript 7 and crashed ESLint. npm
  `overrides` cannot nest a peer dependency (ERESOLVE).
- **Why not**: Cannot keep two TypeScript versions apart reliably.

### TypeScript 6.0 everywhere

- **Pros**: One TypeScript version. Works with npm.
- **Cons**: Not the latest compiler; slower type checking.
- **Why not**: The project uses the latest TypeScript.

### Drop type-aware lint rules, or replace ESLint

- **Pros**: No second TypeScript.
- **Cons**: Loses checks such as floating promises and unsafe `any`, or
  changes the requested tool.
- **Why not**: The isolated 6.0 costs one dependency line.

## Consequences

### Positive

- Fast type checking with TypeScript 7 and full type-aware linting.
- pnpm's strict `node_modules` stops packages from importing undeclared
  dependencies.

### Negative

- Contributors must install pnpm 12. Anyone with a Corepack pnpm shim needs
  `corepack disable pnpm` first.
- The linter parses with TypeScript 6.0, so syntax that only TypeScript 7
  understands would fail lint until `typescript-eslint` supports 7.

### Risks

- The two TypeScript versions could disagree. Mitigation: `tsconfig.base.json`
  uses only options both understand. Remove the private 6.0 once
  `typescript-eslint` supports TypeScript 7.
