# ADR-0022: Frontmatter edited as a YAML document, with schema-driven controls

**Date**: 2026-09-16
**Status**: accepted
**Implements**: [ADR-0007](0007-frontmatter-schema-inference.md)
**Deciders**: Project maintainers

## Context

ADR-0007 decided that frontmatter fields are inferred from
`content.config.ts` and existing entries, falling back to raw YAML when
inference is not safe. It did not say how an inferred field becomes an
editable control, or how an edit to one field gets written back without
disturbing everything else in the file: a naive `YAML.parse` then
`YAML.stringify` round trip reformats the whole document — reordering keys,
dropping comments, changing quote style — on the very first save, and that
reformatting lands in the publish diff next to whatever the person actually
meant to change.

## Decision

Frontmatter is edited as a `yaml@2.9` `Document`, not parsed and
re-serialised. `document.ts` wraps it as `parseFrontmatter` /
`FrontmatterDocument`; a control calls `set`/`remove` on one key, and every
key nobody touched keeps its comments, order, and quoting. `toString()`
passes `{ flowCollectionPadding: false }`, without which `tags: [astro, cms]`
becomes `tags: [ astro, cms ]` on any save at all, and an empty document — a
post with no frontmatter — is special-cased back to `""` rather than the
library's default `"null\n"`.

Each of the twelve field types the static content-config parser produces
gets a control plan (`fields.ts`). Five map to real controls — text (or a
textarea once a value spans lines), number, checkbox, date, and select for
an enum — plus a tag input for an array of strings. The other six
(`literal`, `object`, `image`, `reference`, `union`, `unknown`), and an array
of anything but strings, fall back to a raw YAML box for that field alone,
labelled with why: a wrong control — a text input mangling a nested object,
say — is worse than an honest "no control yet". Keys in the file the schema
does not mention at all appear, still editable, in an "Other fields" box
below the known fields.

That gives three fallback levels, each narrower than the last, which is
ADR-0007's promise kept concretely: the whole editor falls back to today's
raw textarea when the schema cannot be inferred, the collection request
fails, or the frontmatter itself is not valid YAML; one field falls back to
a raw box when its type has no control; and a key outside the schema falls
back to the Other fields box. None of the three blocks the body editor — a
person can always keep writing the post.

A required field left empty is marked with a warning, but the document
still saves: refusing to save would lose whatever else the person just
wrote, and a draft is allowed to be unfinished.

**The preservation guarantee is weaker than ADR-0006's byte-for-byte promise
for MDX the CMS cannot edit at all.** Frontmatter the CMS does edit gets
close but not that: whitespace immediately before an inline comment is
normalised, so `legacyId: 4821   # keep` becomes `legacyId: 4821 # keep` even
though `legacyId` was never touched. That is a property of the `yaml`
library's writer, not something this design chose, and it is the price of
being able to edit frontmatter through controls at all rather than leaving
it as an opaque string.

**A raw box holds its own text, not the document's.** Driving a box straight
from the document, and writing back only once the text parses, sounds like
the obvious design — the document already never receives YAML that fails to
parse, so nothing is lost by enforcing that at the box too. But typing
itself would become impossible: `[`, `{`, and `"Hello` are all YAML that
does not parse, so a box that only shows what the document holds would
erase every one of those keystrokes before the person could finish typing an
opening bracket or quote. The box therefore keeps its own text in component
state; the document is updated, and the "never receives invalid YAML"
guarantee holds, only once that text parses, and the box shows a hint in
between saying the field is unchanged.

One further wrinkle, accepted rather than fixed: **a raw box's initial text
comes from `getRaw`, which re-serialises the value through `toJSON` rather
than reading the document's own formatting.** A key written
`tags: [astro, cms]` in the file displays as a block sequence the first time
its raw box renders, and any quote style on that key is not preserved
either. This only affects fields with no control, and only what is shown
before the person edits it — every other key's YAML is untouched on disk —
so it was accepted rather than built around.

## Alternatives Considered

### Full parse and re-serialise (`YAML.parse` then `YAML.stringify`)

- **Pros**: The simplest possible implementation; no dependency on
  preserving structure at all.
- **Cons**: Reformats every post's frontmatter on its first save, whether or
  not the person touched most of it — reordered keys, dropped comments, and
  changed quoting all show up in the publish diff next to the one field
  that actually changed.
- **Why not**: A diff a reviewer cannot read past is worse than no controls
  at all.

### A read-only schema summary above the raw YAML box

- **Pros**: No preservation problem, because nothing writes back through a
  schema-aware path; trivial to build.
- **Cons**: Does not deliver the feature — a person still types YAML by hand
  for every field.
- **Why not**: ADR-0007 already accepted raw YAML as the fallback; this
  would make it the only option instead of the last resort.

### Parsing frontmatter server-side

- **Pros**: Keeps the client thin; a schema change could be validated
  against one shared implementation.
- **Cons**: The server treats frontmatter as opaque, end to end, today —
  nothing about a document's shape reaches it. Parsing there would add a
  round trip per edit, which a control firing on every keystroke cannot
  afford.
- **Why not**: Worth revisiting only if MCP ever wants field-level edits of
  its own; until then the round trip buys nothing the browser doesn't
  already have.

## Consequences

### Positive

- A person edits five field types, plus arrays of strings, with the right
  control instead of hand-typing YAML for them.
- Editing one field never reformats another: comments, key order, and quote
  style on untouched keys survive.
- Every fallback is per-field and labelled, so a raw box never looks like a
  bug — it says why it is raw.

### Negative

- Six of twelve field types still fall back to raw YAML, so a schema heavy
  in `object`, `reference`, or `image` fields sees little benefit from this
  pass; those wait on a media picker and recursive/related-collection UI
  that do not exist yet.
- A raw field's first render can show YAML reformatted from how the file
  has it (block vs. flow style, quoting), even though editing it afterward
  round-trips correctly.

### Risks

- Whitespace before an inline comment on any key — touched or not — is
  normalised on save. Documented here and in the design doc; someone will
  eventually diff a publish and wonder why a line they did not touch moved
  by one space.
- `yaml@2.9` is the first YAML dependency in this repository, and it runs in
  the browser. It is the de-facto standard for Node and mostly already a
  transitive dependency of the ecosystem, but it is new surface here.
- The components (`FrontmatterFields.tsx`, `controls.tsx`, and
  `DocumentEditor.tsx`'s wiring) have no unit tests: this repository has no
  React testing library, and no component is unit-tested today. The
  branching logic — which control a type gets, what YAML value a control
  writes — lives in `fields.ts` and `document.ts`, which are pure and
  tested; the components were checked by hand in a browser instead.
