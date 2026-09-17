import {
  mergeAttributes,
  Node,
  type Content,
  type Extensions,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import {
  MDX_BLOCK,
  MDX_INLINE,
  type EditorDoc,
  type ProtectedBlockKind,
} from "@astro-cms/markdown";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import {
  DEFAULT_IMAGE_UPLOAD,
  ImageUpload,
  type ImageUploadOptions,
} from "./imageUpload.ts";
import { SlashCommand, type SlashCommandOptions } from "./SlashCommand.ts";

/** The Yjs field name; the CMS reads the same one from the webhook. */
export const COLLAB_FIELD = "default";

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

/** Inline JSX, expressions, footnotes, and other inline content kept verbatim. */
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
export interface CollaborationOptions {
  readonly doc: Y.Doc;
  readonly provider: HocuspocusProvider;
  readonly user: { readonly name: string; readonly color: string };
}

export function editorExtensions(
  slash?: SlashCommandOptions,
  collaboration?: CollaborationOptions,
  images?: ImageUploadOptions,
): Extensions {
  return [
    StarterKit.configure({
      // Markdown-style input rules and keyboard shortcuts come from StarterKit.
      link: { openOnClick: false, autolink: true },
      codeBlock: { languageClassPrefix: "language-" },
      // Yjs keeps the history when a room is open.
      ...(collaboration ? { undoRedo: false as const } : {}),
    }),
    Placeholder.configure({
      placeholder: "Type / for a heading, image, list or quote.",
    }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    // Inline, because a Markdown image is phrasing content inside a paragraph.
    Image.configure({ inline: true, allowBase64: false }),
    ImageUpload.configure(images ?? DEFAULT_IMAGE_UPLOAD),
    MdxBlock,
    MdxInline,
    ...(slash ? [SlashCommand.configure(slash)] : []),
    ...(collaboration
      ? [
          Collaboration.configure({
            document: collaboration.doc,
            field: COLLAB_FIELD,
          }),
          CollaborationCaret.configure({
            provider: collaboration.provider,
            user: collaboration.user,
          }),
        ]
      : []),
  ];
}

/**
 * A parsed document as editor content. The shapes match; only readonly
 * differs, which Tiptap's Content type does not express.
 */
export function toEditorContent(doc: EditorDoc): Content {
  return doc as unknown as Content;
}
