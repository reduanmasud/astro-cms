# ADR-0018: Images are editable nodes, and pasting one uploads it

**Date**: 2026-09-12
**Status**: accepted
**Narrows**: [ADR-0006](0006-mdx-opaque-blocks.md)
**Builds on**: [ADR-0017](0017-media-storage.md)
**Deciders**: Project maintainers

## Context

[ADR-0006](0006-mdx-opaque-blocks.md) says anything the editor cannot edit is
kept verbatim and written back byte-for-byte. Images fell into that bucket:
`![alt](./hero.png)` parsed to an opaque inline node and showed in the editor
as inert text.

That was the wrong side of the line. An image is ordinary Markdown, the
product calls for pasting a screenshot and seeing it appear, and the media
subsystem to store one now exists.

Keeping images opaque also lost data: `[![alt](./a.png)](https://example.com)`
round-tripped to `![alt](./a.png)`, silently dropping the link, because the
opaque node captured the image and discarded the link wrapping it.

## Decision

**An image is a first-class inline node.** The mdast `image` node maps to a
Tiptap `image` node and back. It is inline, not a block, because a Markdown
image is phrasing content that lives inside a paragraph — anything else would
change the Markdown on a round trip. MDX components such as
`<Image src="./hero.png" />` stay opaque: they are JSX, and ADR-0006 still
governs them.

**Pasting or dropping an image uploads it.** The file goes through
`POST /api/media` ([ADR-0017](0017-media-storage.md)) and the returned public
URL becomes the node's `src`. The same path serves both gestures.

**A pending upload is a decoration, never a node.** While bytes are in
flight the editor shows a placeholder decoration, which lives outside the
document. Nothing enters the shared Yjs document until the upload succeeds.

## Alternatives Considered

### Leave images opaque and insert `![alt](url)` text on paste

- **Pros**: No change to the document model; no round-trip risk at all.
- **Cons**: The image never renders, so pasting a screenshot shows a line of
  text. The dropped-link bug stays.
- **Why not**: It does not deliver the feature.

### A block-level image node

- **Pros**: Matches how most editors treat images, and is simpler to select.
- **Cons**: A block node cannot sit inside a paragraph, so
  `Text ![a](b) more` would have to be split across blocks and would not
  serialize back to the same Markdown.
- **Why not**: Astro's content is the source of truth; the round trip wins.

### A placeholder node in the document

- **Pros**: Collaborators see the upload happening in place.
- **Cons**: Transient state enters the shared document. A tab that dies
  mid-upload leaves a placeholder for everyone, and it must be filtered out of
  serialization or it reaches GitHub.
- **Why not**: A decoration gives the uploader the same feedback and makes the
  failure modes impossible rather than handled.

## Consequences

### Positive

- Pasting a screenshot inserts a real, visible image.
- Linked images survive a round trip; a silent data loss is fixed.
- A failed upload cannot leave anything behind in the draft.

### Negative

- The editable/opaque boundary now has one more exception to keep in mind.
- Collaborators see nothing during the second or two an upload takes.

### Risks

- Re-serializing images that were previously opaque could change existing
  drafts. Mitigation: round-trip tests cover an image alone, among text, with
  a title, without alt text, and inside a link; the existing "second round
  trip is identical" test guards the rest.
- Paste makes media references far more common while reference counting still
  sees drafts only. Mitigation: nothing is deleted automatically; the
  collector waits for publishing to scan pull requests and `main`
  ([ADR-0008](0008-media-storage-and-gc.md)).
