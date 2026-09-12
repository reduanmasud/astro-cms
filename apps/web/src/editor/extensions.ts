import {
  mergeAttributes,
  Node,
  type Content,
  type Extensions,
} from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import {
  MDX_BLOCK,
  MDX_INLINE,
  type EditorDoc,
  type ProtectedBlockKind,
} from "@astro-cms/markdown";
import { SlashCommand, type SlashCommandOptions } from "./SlashCommand.ts";

const BLOCK_LABELS: Record<ProtectedBlockKind, string> = {
  esm: "MDX import / export",
  jsx: "MDX component",
  expression: "MDX expression",
  html: "HTML block",
  markdown: "Markdown kept as-is",
};

/**
 * A block the editor cannot edit. It is shown read-only and written back
 * byte-for-byte (docs/adr/0006-mdx-opaque-blocks.md).
 */
export const MdxBlock = Node.create({
  name: MDX_BLOCK,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: { default: "markdown" as ProtectedBlockKind },
      source: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-mdx-block]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = node.attrs.kind as ProtectedBlockKind;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-mdx-block": kind,
        class: "mdx-block",
      }),
      [
        "span",
        { class: "mdx-block-label" },
        BLOCK_LABELS[kind] ?? BLOCK_LABELS.markdown,
      ],
      ["pre", {}, String(node.attrs.source)],
    ];
  },
});

/** Inline JSX, expressions, images, and other inline content kept verbatim. */
export const MdxInline = Node.create({
  name: MDX_INLINE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { source: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-mdx-inline]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-mdx-inline": "",
        class: "mdx-inline",
      }),
      String(node.attrs.source),
    ];
  },
});

/**
 * The editor's document model. Node names match what @astro-cms/markdown
 * produces, so a parsed document loads without conversion.
 */
export function editorExtensions(slash?: SlashCommandOptions): Extensions {
  return [
    StarterKit.configure({
      // Markdown-style input rules and keyboard shortcuts come from StarterKit.
      link: { openOnClick: false, autolink: true },
      codeBlock: { languageClassPrefix: "language-" },
    }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    MdxBlock,
    MdxInline,
    ...(slash ? [SlashCommand.configure(slash)] : []),
  ];
}

/**
 * A parsed document as editor content. The shapes match; only readonly
 * differs, which Tiptap's Content type does not express.
 */
export function toEditorContent(doc: EditorDoc): Content {
  return doc as unknown as Content;
}
