/**
 * The editor document model: ProseMirror/Tiptap JSON. It is deliberately
 * plain data so that parsing and serializing do not depend on the editor.
 */

export type DocumentFormat = "md" | "mdx";

export interface EditorMark {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
}

export interface EditorNode {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly EditorNode[];
  readonly text?: string;
  readonly marks?: readonly EditorMark[];
}

export interface EditorDoc {
  readonly type: "doc";
  readonly content: readonly EditorNode[];
}

export interface ParsedDocument {
  /** Raw YAML between the `---` fences, or null when the file has none. */
  readonly frontmatter: string | null;
  readonly doc: EditorDoc;
}

/**
 * Content the editor cannot edit is kept verbatim in these nodes and written
 * back byte-for-byte (docs/adr/0006-mdx-opaque-blocks.md).
 *
 * - `esm`: an MDX `import` or `export`
 * - `jsx`: an MDX/JSX component
 * - `expression`: an MDX `{...}` block
 * - `html`: a raw HTML block
 * - `markdown`: any other construct the editor does not support
 */
export type ProtectedBlockKind =
  "esm" | "jsx" | "expression" | "html" | "markdown";

export const MDX_BLOCK = "mdxBlock";
export const MDX_INLINE = "mdxInline";

export function protectedBlock(
  kind: ProtectedBlockKind,
  source: string,
): EditorNode {
  return { type: MDX_BLOCK, attrs: { kind, source } };
}

export function protectedInline(source: string): EditorNode {
  return { type: MDX_INLINE, attrs: { source } };
}
