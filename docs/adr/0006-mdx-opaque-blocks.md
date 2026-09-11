# ADR-0006: Preserve unsupported MDX as opaque, read-only blocks

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: Project maintainers

## Context

Astro content can be MDX, which allows `import`/`export` statements and
arbitrary JSX components. A rich-text editor like Tiptap cannot represent
arbitrary JSX. Converting it lossily would corrupt content on the next publish.

## Decision

Markdown constructs the editor supports are edited normally. `import` and
`export` statements, and any JSX/MDX component the editor does not support,
become opaque, read-only blocks whose original source is kept byte-for-byte and
written back unchanged on serialization. v1 does not try to fully edit
arbitrary MDX.

## Alternatives Considered

### Full MDX editing with per-component UIs

- **Pros**: Richer editing.
- **Cons**: Needs component prop schemas and a UI for each component. Large scope.
- **Why not**: A future feature, not v1.

### Treat MDX files as raw text only

- **Pros**: Trivially lossless.
- **Cons**: No rich editing or live collaboration on the prose in MDX files.
- **Why not**: Loses most of the editing value for MDX users.

## Consequences

### Positive

- Round-trips never corrupt unsupported MDX.
- The prose around components is still editable.

### Negative

- Users cannot change component props from the rich editor in v1.

### Risks

- Formatting drift in the _supported_ Markdown (e.g. `*` vs `-` for list
  bullets) creates noisy diffs. Mitigation: round-trip tests on real Astro
  content, and serializer settings matched to common Markdown style.
