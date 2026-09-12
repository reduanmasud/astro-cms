import type {
  AlignType,
  BlockContent,
  PhrasingContent,
  RootContent,
  TableRow,
} from "mdast";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import {
  MDX_BLOCK,
  MDX_INLINE,
  type DocumentFormat,
  type EditorDoc,
  type EditorMark,
  type EditorNode,
  type ParsedDocument,
} from "./model.ts";

/** Matches common Markdown style so diffs stay small. */
const STYLE = {
  bullet: "-",
  emphasis: "_",
  strong: "*",
  fence: "`",
  fences: true,
  rule: "-",
  ruleRepetition: 3,
  listItemIndent: "one",
  incrementListMarker: true,
} as const;

/** An editor document back to Markdown or MDX, with frontmatter restored. */
export function serializeDocument(
  { frontmatter, doc }: ParsedDocument,
  _format: DocumentFormat,
): string {
  const body = toMarkdown(
    { type: "root", children: doc.content.flatMap(toBlock) },
    { ...STYLE, extensions: [gfmToMarkdown({ tablePipeAlign: false })] },
  );
  const head =
    frontmatter === null
      ? ""
      : `---\n${frontmatter === "" ? "" : `${frontmatter}\n`}---\n\n`;
  return `${head}${body}`;
}

function toBlocks(nodes: readonly EditorNode[] | undefined): BlockContent[] {
  return (nodes ?? []).flatMap(toBlock) as BlockContent[];
}

function toBlock(node: EditorNode): RootContent[] {
  switch (node.type) {
    case "heading":
      return [
        {
          type: "heading",
          depth: depth(node.attrs?.level),
          children: toInlines(node.content),
        },
      ];
    case "paragraph":
      return [{ type: "paragraph", children: toInlines(node.content) }];
    case "blockquote":
      return [{ type: "blockquote", children: toBlocks(node.content) }];
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      return [
        {
          type: "list",
          ordered,
          start: ordered ? numberOr(node.attrs?.start, 1) : null,
          spread: false,
          children: (node.content ?? []).map((item) => ({
            type: "listItem",
            spread: false,
            checked: null,
            children: toBlocks(item.content),
          })),
        },
      ];
    }
    case "codeBlock":
      return [
        {
          type: "code",
          lang:
            typeof node.attrs?.language === "string"
              ? node.attrs.language
              : null,
          meta: null,
          value: plainText(node.content),
        },
      ];
    case "horizontalRule":
      return [{ type: "thematicBreak" }];
    case "table":
      return [
        {
          type: "table",
          align: alignment(node.attrs?.align),
          children: (node.content ?? []).map(toTableRow),
        },
      ];
    case MDX_BLOCK:
      // Written back exactly as it was read.
      return [{ type: "html", value: sourceOf(node) }];
    default:
      // Unknown block: keep its text rather than dropping it.
      return [{ type: "paragraph", children: toInlines(node.content) }];
  }
}

function toTableRow(row: EditorNode): TableRow {
  return {
    type: "tableRow",
    children: (row.content ?? []).map((cell) => ({
      type: "tableCell",
      children: (cell.content ?? []).flatMap((child) =>
        toInlines(child.content),
      ),
    })),
  };
}

function toInlines(
  nodes: readonly EditorNode[] | undefined,
): PhrasingContent[] {
  return groupMarks(nodes ?? [], 0);
}

/**
 * Nests marks shared by neighbouring text runs, so `**bold _italic_**` stays
 * one strong node instead of two.
 */
function groupMarks(
  nodes: readonly EditorNode[],
  depth: number,
): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let index = 0;

  while (index < nodes.length) {
    const node = nodes[index];
    if (node === undefined) break;
    const mark = (node.marks ?? [])[depth];

    // `code` cannot wrap other nodes, so it is handled on the leaf itself.
    if (mark === undefined || mark.type === "code") {
      result.push(...leaf(node, depth));
      index += 1;
      continue;
    }

    let end = index + 1;
    while (
      end < nodes.length &&
      sameMark((nodes[end]?.marks ?? [])[depth], mark)
    )
      end += 1;
    result.push(
      ...wrapMark(mark, groupMarks(nodes.slice(index, end), depth + 1)),
    );
    index = end;
  }
  return result;
}

function leaf(node: EditorNode, depth: number): PhrasingContent[] {
  if (node.type === MDX_INLINE)
    return [{ type: "html", value: sourceOf(node) }];
  if (node.type === "hardBreak") return [{ type: "break" }];
  if (node.type === "image") {
    const attr = (name: string): string | undefined =>
      typeof node.attrs?.[name] === "string" ? node.attrs[name] : undefined;
    return [
      {
        type: "image",
        url: attr("src") ?? "",
        alt: attr("alt") ?? null,
        title: attr("title") ?? null,
      },
    ];
  }
  if (node.type !== "text") return toInlines(node.content);

  const value = node.text ?? "";
  const rest = (node.marks ?? []).slice(depth);
  return [
    rest.some((mark) => mark.type === "code")
      ? { type: "inlineCode", value }
      : { type: "text", value },
  ];
}

function sameMark(
  candidate: EditorMark | undefined,
  mark: EditorMark,
): boolean {
  return (
    candidate !== undefined &&
    candidate.type === mark.type &&
    JSON.stringify(candidate.attrs ?? {}) === JSON.stringify(mark.attrs ?? {})
  );
}

function wrapMark(
  mark: EditorMark,
  children: PhrasingContent[],
): PhrasingContent[] {
  switch (mark.type) {
    case "bold":
      return hoistSpaces(children, (inner) => ({
        type: "strong",
        children: inner,
      }));
    case "italic":
      return hoistSpaces(children, (inner) => ({
        type: "emphasis",
        children: inner,
      }));
    case "strike":
      return hoistSpaces(children, (inner) => ({
        type: "delete",
        children: inner,
      }));
    case "link":
      return hoistSpaces(children, (inner) => ({
        type: "link",
        url: typeof mark.attrs?.href === "string" ? mark.attrs.href : "",
        title: typeof mark.attrs?.title === "string" ? mark.attrs.title : null,
        children: inner,
      }));
    default:
      // An unknown mark keeps its content rather than dropping it.
      return children;
  }
}

/**
 * Moves leading and trailing spaces outside the mark: `**bold** ` rather than
 * `**bold&#x20;**`, which is what Markdown would otherwise need.
 */
function hoistSpaces(
  children: PhrasingContent[],
  wrap: (inner: PhrasingContent[]) => PhrasingContent,
): PhrasingContent[] {
  const inner = [...children];
  let leading = "";
  let trailing = "";

  const first = inner[0];
  if (first?.type === "text") {
    const match = /^(\s+)([\s\S]*)$/.exec(first.value);
    if (match?.[1] !== undefined) {
      leading = match[1];
      if (match[2] === "") inner.shift();
      else inner[0] = { type: "text", value: match[2] ?? "" };
    }
  }

  const lastIndex = inner.length - 1;
  const last = inner[lastIndex];
  if (last?.type === "text") {
    const match = /^([\s\S]*?)(\s+)$/.exec(last.value);
    if (match?.[2] !== undefined) {
      trailing = match[2];
      if (match[1] === "") inner.splice(lastIndex, 1);
      else inner[lastIndex] = { type: "text", value: match[1] ?? "" };
    }
  }

  const result: PhrasingContent[] = [];
  if (leading !== "") result.push({ type: "text", value: leading });
  if (inner.length > 0) result.push(wrap(inner));
  if (trailing !== "") result.push({ type: "text", value: trailing });
  return result;
}

function sourceOf(node: EditorNode): string {
  return typeof node.attrs?.source === "string" ? node.attrs.source : "";
}

function plainText(nodes: readonly EditorNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => node.text ?? plainText(node.content))
    .join("");
}

function depth(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = numberOr(value, 1);
  return (level >= 1 && level <= 6 ? level : 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function alignment(value: unknown): AlignType[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).map((item) =>
    item === "left" || item === "right" || item === "center" ? item : null,
  );
}

/** True when the document has no content at all. */
export function isEmptyDoc(doc: EditorDoc): boolean {
  return doc.content.length === 0;
}
