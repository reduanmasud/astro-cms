# ADR-0007: Infer frontmatter from content.config.ts and entries, fall back to raw YAML

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

Astro collections declare frontmatter schemas with Zod in `content.config.ts`,
which can contain arbitrary TypeScript. Running that code inside the CMS is
unsafe and fragile. Still, editors benefit from typed form fields.

## Decision

We derive frontmatter fields from `content.config.ts` (analyzed statically,
never executed) and from existing entries in the collection. When a field or
collection cannot be inferred safely, the UI falls back to a raw YAML
frontmatter editor. v1 has no second, CMS-specific schema or config system.

## Alternatives Considered

### A CMS config file declaring fields

- **Pros**: Precise, predictable forms.
- **Cons**: A second schema that drifts from the Astro schema.
- **Why not**: Duplicates the source of truth.

### Execute content.config.ts

- **Pros**: Exact schemas.
- **Cons**: Runs untrusted repository code on the server and needs Astro's
  dependencies installed.
- **Why not**: Security and complexity.

### Raw YAML only

- **Pros**: Simplest and always correct.
- **Cons**: Worse editing experience.
- **Why not**: Kept as the fallback, not the default.

## Consequences

### Positive

- The Astro project stays the single source of truth for schemas.
- Every collection is editable, even when inference fails.

### Negative

- Some fields show up as raw YAML instead of form controls.

### Risks

- Inference could guess a wrong type. Mitigation: infer only simple patterns
  with high confidence, and fall back to raw YAML otherwise.
