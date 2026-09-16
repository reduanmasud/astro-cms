# Frontmatter fields: the schema the project already declares, as controls

**Date**: 2026-09-16
**Status**: approved, not yet implemented
**Implements**: [ADR-0007](../../adr/0007-frontmatter-schema-inference.md)

## Goal

Edit a post's frontmatter with controls that match the collection's schema —
a checkbox for `draft`, a date picker for `publishedAt`, a select for an enum —
instead of typing YAML by hand.

The CMS already reads `content.config.ts` and knows every field's name, type,
and whether it is required. The collection browser even says "5 fields". None
of it reaches the editor, which still shows a raw YAML textarea.

## Decisions

Settled before design, and not revisited here:

- **Edits are surgical.** Keys the person did not touch keep their comments,
  order, and quoting. A first save must not reformat someone's frontmatter.
- **Five types get controls**, arrays of strings get a tag input, and
  everything else falls back to a raw box for that field alone.
- **Unknown keys are shown**, in an "Other fields" box, and remain editable.

## Shape

```
apps/web/src/frontmatter/
  document.ts     YAML in, YAML out. No React.
  fields.tsx      Schema -> controls.
  controls.tsx    One small component per control kind.
```

`DocumentEditor` fetches the collection alongside the document, hands the
schema and the frontmatter to `fields.tsx`, and keeps its existing autosave
contract: a field edit writes a new frontmatter string into the ref it
already holds.

## The YAML layer

`document.ts` wraps `yaml@2.9` — the first YAML dependency in this
repository — using its `Document` API rather than `parse`/`stringify`:

```ts
parseFrontmatter(source: string | null): FrontmatterDocument | undefined
```

with `get(key)`, `set(key, value)`, `remove(key)`, `keys()`, and
`toString()`. It returns `undefined` when the source is not valid YAML, which
is the caller's signal to fall back.

Measured, not assumed: parsing a post with a leading comment, a
double-quoted title, a block sequence, and a trailing inline comment, then
calling `set()` on two keys, returns every one of those intact.

**One honest caveat.** Whitespace _before_ an inline comment is normalised
(`legacyId: 4821   # keep` becomes `legacyId: 4821 # keep`). So this is
comment-, order-, and style-preserving — not byte-for-byte. Anything the
CMS cannot edit at all is still preserved byte-for-byte, as
[ADR-0006](../../adr/0006-mdx-opaque-blocks.md) requires of MDX; frontmatter
the CMS _does_ edit gets this weaker guarantee, which is the price of
editing it at all.

Two implementation details this rests on, both measured rather than assumed:

- **`toString()` must pass `{ flowCollectionPadding: false, lineWidth: 0 }`.**
  Without the first, `tags: [astro, cms]` becomes `tags: [ astro, cms ]` on
  any save at all — even one that changes nothing else in the file. Without
  the second, `yaml`'s default 80-column width reflows any long scalar (a
  one-line `description`, say) across multiple lines on every save, which is
  the more consequential of the two: it would put a reflow diff next to
  whatever key the person actually meant to change.
- **An empty document stringifies to `"null\n"`, not `""`.** A post with no
  frontmatter must keep having none rather than gaining a literal `null`.

## Controls

The parser emits twelve field types. Five get real controls, plus arrays of
strings:

| Type                | Control                                          |
| ------------------- | ------------------------------------------------ |
| `string`            | text input; textarea when the value has newlines |
| `string` + `format` | `type="email"` or `type="url"`                   |
| `number`            | number input                                     |
| `boolean`           | checkbox                                         |
| `date`              | date input (`YYYY-MM-DD`)                        |
| `enum`              | select over `values`                             |
| `array` of `string` | tag input                                        |

The remaining six — `literal`, `object`, `image`, `reference`, `union`,
`unknown` — and arrays of anything but strings get a small raw-YAML box for
that field alone, labelled with the reason. They are the cases where a
wrong control would be worse than no control: `reference` needs another
collection's entries, `object` needs recursive rendering, and `image` wants
a media picker that does not exist yet.

A `nullable` field may be cleared. A required field is marked; a required
field left empty shows a warning and **still saves** — a draft is allowed to
be unfinished, and refusing to save would lose work.

**A control also falls back when the file's value doesn't fit its value
space**, even for one of the five types above: a `date` not in
`YYYY-MM-DD`, an `enum` value outside its declared `values`, or a `number`
that isn't numeric. Each of these controls renders such a value as blank
rather than erroring — indistinguishable, for a required field, from the
field being unset, with nothing explaining why and the data sitting there
intact underneath. The raw-box fallback applies here too, labelled with the
reason, rather than leaving the person looking at a control that lies about
the file's contents.

## Unknown keys

Keys in the file that the schema does not mention — a legacy field, or one
the static parser could not model — appear in an **Other fields** YAML box
below the controls. Editable, round-tripped through the same document, never
silently dropped.

## Falling back

Three levels, each narrower than the last:

1. **Whole editor.** `schema.inferred === false`, the collection request
   failed, or the frontmatter is not valid YAML → today's raw textarea, with
   the reason shown. This is [ADR-0007](../../adr/0007-frontmatter-schema-inference.md)'s
   promise kept.
2. **One field.** A type with no control → a raw box for that key.
3. **Leftovers.** Keys outside the schema → the Other fields box.

The body editor never blocks on any of this. A failure to understand
frontmatter must not stop someone writing a post.

## Data flow

```
load:   getDocument(id)              (already happens)
      + getCollection(collection)    (new)
        -> parseFrontmatter(document.frontmatter)

edit:   control -> doc.set(key, value)
        -> frontmatterRef.current = doc.toString()
        -> autosave.schedule()          (unchanged)

save:   serializeDocument({ frontmatter, doc })   (unchanged)
```

The collection request is additive: if it fails, the editor falls back
rather than refusing to open. Nothing about the save path changes.

## Errors

| Situation                          | What happens                                                  |
| ---------------------------------- | ------------------------------------------------------------- |
| Schema not inferred                | Raw textarea, with the parser's reason                        |
| Collection request fails           | Raw textarea, with the error                                  |
| Frontmatter is not valid YAML      | Raw textarea, with the parse error                            |
| A field's type has no control      | Raw box for that field                                        |
| A required field is empty          | Warning beside it; saving still works                         |
| A per-field raw box holds bad YAML | That field keeps its last good value; the box shows the error |

## Testing

Against real YAML, not mocks:

- A post with a leading comment, a quoted title, deliberate key order, and a
  trailing inline comment survives an edit to two unrelated keys.
- Each control writes the right YAML scalar: a checkbox writes `true`, not
  `"true"`; a number writes `3`, not `"3"`; a date writes `2026-01-15`.
- A tag input round-trips a block sequence.
- Unknown keys survive an edit to a known key.
- `schema.inferred === false` renders the raw textarea and never the controls.
- Malformed YAML renders the raw textarea rather than throwing.
- A required field left empty warns, and the document still saves.
- Clearing a nullable field removes the key rather than writing `""`.

## Out of scope

A media picker for `image` (it wants the media library, which does not exist
yet). Recursive forms for `object`. A `reference` select populated from
another collection. Validation beyond required-ness — the schema is
authoritative at build time, and Astro will say more than the CMS can.
Reordering or adding keys the schema does not declare.

## Risks

- **This is the first YAML dependency in the repository.** `yaml` is the
  de-facto standard and is already a transitive dependency of much of the
  ecosystem, but it is new surface here, and it runs in the browser.
- **The weaker preservation guarantee.** Inline-comment whitespace is
  normalised. Documented above, and to be recorded in the ADR this work adds
  (ADR-0022), because someone will eventually diff a publish and wonder why
  a line they did not touch moved.
- **Six of twelve types still fall back**, so a schema heavy in references or
  objects sees little benefit from this pass. The fallback is per-field and
  labelled, so at least it is obvious why.
