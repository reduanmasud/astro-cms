import type {
  Nodes,
  Parent,
  PhrasingContent,
  RootContent,
  TableCell,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { gfm } from "micromark-extension-gfm";
import { mdxjs } from "micromark-extension-mdxjs";
import {
  protectedBlock,
  protectedInline,
  type DocumentFormat,
  type EditorMark,
  type EditorNode,
  type ParsedDocument,
} from "./model.ts";

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

/** Splits `---` frontmatter from the body without parsing the YAML. */
export function splitFrontmatter(source: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = FRONTMATTER.exec(source);
  if (!match) return { frontmatter: null, body: source };
  return {
    frontmatter: match[1] ?? "",
    body: source.slice(match[0].length).replace(/^\r?\n/, ""),
  };
}

/** Markdown or MDX to an editor document. Unsupported constructs are preserved. */
export function parseDocument(
  source: string,
  format: DocumentFormat,
): ParsedDocument {
  const { frontmatter, body } = splitFrontmatter(source);
  const tree = fromMarkdown(body, {
    extensions: format === "mdx" ? [gfm(), mdxjs()] : [gfm()],
    mdastExtensions:
      format === "mdx"
        ? [gfmFromMarkdown(), mdxFromMarkdown()]
        : [gfmFromMarkdown()],
  });

  return {
    frontmatter,
    doc: { type: "doc", content: blocks(tree.children, body) },
  };
}

function blocks(nodes: readonly RootContent[], source: string): EditorNode[] {
  return nodes.map((node) => block(node, source));
}

function block(node: RootContent, source: string): EditorNode {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        attrs: { level: node.depth },
        content: inlines(node.children, source),
      };
    case "paragraph":
      return { type: "paragraph", content: inlines(node.children, source) };
    case "blockquote":
      return { type: "blockquote", content: blocks(node.children, source) };
    case "list":
      return {
        type: node.ordered ? "orderedList" : "bulletList",
        ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
        content: node.children.map((item) => ({
          type: "listItem",
          content: blocks(item.children, source),
        })),
      };
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null },
        content: node.value === "" ? [] : [{ type: "text", text: node.value }],
      };
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "table":
      return {
        type: "table",
        attrs: { align: node.align ?? [] },
        content: node.children.map((row, index) => ({
          type: "tableRow",
          content: row.children.map((cell) =>
            tableCell(cell, index === 0, source),
          ),
        })),
      };
    case "mdxjsEsm":
      return protectedBlock("esm", raw(node, source));
    case "mdxJsxFlowElement":
      return protectedBlock("jsx", raw(node, source));
    case "mdxFlowExpression":
      return protectedBlock("expression", raw(node, source));
    case "html":
      return protectedBlock("html", raw(node, source));
    default:
      // definitions, footnote definitions, and anything else: keep the source.
      return protectedBlock("markdown", raw(node, source));
  }
}

function tableCell(
  cell: TableCell,
  header: boolean,
  source: string,
): EditorNode {
  return {
    type: header ? "tableHeader" : "tableCell",
    content: [{ type: "paragraph", content: inlines(cell.children, source) }],
  };
}

function inlines(
  nodes: readonly PhrasingContent[],
  source: string,
  marks: readonly EditorMark[] = [],
): EditorNode[] {
  return nodes.flatMap((node) => inline(node, source, marks));
}

function inline(
  node: PhrasingContent,
  source: string,
  marks: readonly EditorMark[],
): EditorNode[] {
  switch (node.type) {
    case "text":
      return [text(node.value, marks)];
    case "strong":
      return inlines(node.children, source, [...marks, { type: "bold" }]);
    case "emphasis":
      return inlines(node.children, source, [...marks, { type: "italic" }]);
    case "delete":
      return inlines(node.children, source, [...marks, { type: "strike" }]);
    case "inlineCode":
      return [text(node.value, [...marks, { type: "code" }])];
    case "link":
      return inlines(node.children, source, [
        ...marks,
        {
          type: "link",
          attrs: {
            href: node.url,
            ...(node.title == null ? {} : { title: node.title }),
          },
        },
      ]);
    case "break":
      return [{ type: "hardBreak" }];
    case "image":
      return [
        {
          type: "image",
          attrs: {
            src: node.url,
            ...(node.alt == null ? {} : { alt: node.alt }),
            ...(node.title == null ? {} : { title: node.title }),
          },
          ...(marks.length > 0 ? { marks: [...marks] } : {}),
        },
      ];
    default:
      // footnote references, inline JSX/expressions, inline HTML: kept as-is.
      return [protectedInline(raw(node, source))];
  }
}

function text(value: string, marks: readonly EditorMark[]): EditorNode {
  return {
    type: "text",
    text: value,
    ...(marks.length > 0 ? { marks: [...marks] } : {}),
  };
}

/** The exact source of a node, using the offsets the parser recorded. */
function raw(node: Nodes | Parent, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined
    ? ""
    : source.slice(start, end);
}
