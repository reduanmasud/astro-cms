# ADR-0015: Editor document, serialization, and persistence are separate

**Date**: 2026-09-12
**Status**: accepted
**Deciders**: Project maintainers

## Context

The editor has three concerns that are easy to tangle: what a document looks
like while editing, how it is written as Markdown or MDX, and where it is
stored. [ADR-0006](0006-mdx-opaque-blocks.md) also requires that unsupported
MDX survives editing byte-for-byte.

## Decision

Three pieces, in separate places:

1. **Editor document** — ProseMirror/Tiptap JSON. Node names live in
   `@astro-cms/markdown`, and the Tiptap extensions in `apps/web/src/editor`
   use the same names, so a parsed document loads without conversion.
2. **Serialization** — the `@astro-cms/markdown` package converts
   Markdown/MDX to that document and back, using mdast (`mdast-util-*`,
   `micromark-extension-*`) with GFM and MDX support. It has no dependency on
   Tiptap or React and is tested on its own.
3. **Persistence** — the drafts API ([ADR-0013](0013-draft-storage.md)).
   The editor serializes and saves; storage never parses.

Frontmatter is split off before parsing and restored on serialization, so its
YAML is never reformatted. Anything the editor cannot represent — MDX
imports/exports, JSX, expressions, raw HTML, footnote definitions, images —
is kept as a protected node holding the exact source, shown read-only, and
written back unchanged.

That "never reformatted" is a statement about this package, not about the
CMS as a whole: the web editor has since gained schema-driven frontmatter
controls that deliberately edit that YAML through a document API, with a
narrower preservation guarantee of their own
([ADR-0022](0022-frontmatter-controls.md)).

## Alternatives Considered

### Tiptap's Markdown support

- **Pros**: Less code.
- **Cons**: No MDX, and no way to keep unknown constructs verbatim.
- **Why not**: MDX preservation is a requirement.

### Serialize on the server

- **Pros**: One implementation for the web UI and MCP.
- **Cons**: Every keystroke's save would ship editor JSON and re-serialize server-side.
- **Why not**: The package is plain TypeScript; the server can import the same
  code when MCP needs it.

### Store editor JSON and convert only when publishing

- **Pros**: No conversion while editing.
- **Cons**: Drafts stop being readable Markdown; see ADR-0013.
- **Why not**: Markdown is the source of truth's format.

## Consequences

### Positive

- Serialization is tested without a browser; the editor is tested against the
  same node names.
- Unsupported MDX round-trips exactly, proven by tests.

### Negative

- Editing normalizes Markdown style (bullets, emphasis markers, table
  padding), so the first save of an old file can produce a formatting diff.
- A soft line break directly before inline MDX becomes a space.

### Risks

- Divergence between the package's node names and the Tiptap schema.
  Mitigation: a test loads parsed output into a real editor and serializes it
  back.
