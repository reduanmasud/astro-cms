// @vitest-environment jsdom
import {
  parseDocument,
  serializeDocument,
  type EditorDoc,
} from "@astro-cms/markdown";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { editorExtensions, toEditorContent } from "./extensions.ts";
import { filterCommands, SLASH_COMMANDS } from "./SlashCommand.ts";

const SOURCE = [
  'import Chart from "../Chart.astro";',
  "",
  "# Heading",
  "",
  "Text with **bold**, _italic_, ~~struck~~, `code`, a [link](https://example.com) and <Badge count={3} />.",
  "",
  "> A quote",
  "",
  "- one",
  "  - nested",
  "",
  "1. first",
  "2. second",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "<Chart data={[1, 2]} />",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "---",
  "",
  "Done.",
  "",
].join("\n");

function load(doc: EditorDoc): Editor {
  return new Editor({
    extensions: editorExtensions(),
    content: toEditorContent(doc),
  });
}

describe("editor schema", () => {
  it("accepts every node the parser produces", () => {
    const parsed = parseDocument(SOURCE, "mdx");

    const editor = load(parsed.doc);

    expect(editor.getJSON().content).toHaveLength(parsed.doc.content.length);
  });

  it("survives a trip through the editor unchanged", () => {
    const parsed = parseDocument(SOURCE, "mdx");
    const editor = load(parsed.doc);

    const source = serializeDocument(
      { frontmatter: parsed.frontmatter, doc: editor.getJSON() as EditorDoc },
      "mdx",
    );

    expect(source).toBe(SOURCE);
  });

  it("keeps protected MDX blocks read-only and intact", () => {
    const parsed = parseDocument(SOURCE, "mdx");
    const editor = load(parsed.doc);

    const blocks = (editor.getJSON().content ?? []).filter(
      (node) => node.type === "mdxBlock",
    );

    expect(
      blocks.map((block) => (block.attrs as { source: string }).source),
    ).toEqual([
      'import Chart from "../Chart.astro";',
      "<Chart data={[1, 2]} />",
    ]);
  });

  it("keeps soft line breaks inside a paragraph", () => {
    const wrapped = "One line\nand its continuation.\n";
    const editor = load(parseDocument(wrapped, "md").doc);

    const source = serializeDocument(
      { frontmatter: null, doc: editor.getJSON() as EditorDoc },
      "md",
    );

    expect(source).toBe(wrapped);
  });

  it("reflows a line break that sits right before inline MDX, keeping the words", () => {
    // The break becomes a space, which renders the same. Nothing is lost.
    const wrapped = "Text and\n<Badge count={3} /> more.\n";
    const editor = load(parseDocument(wrapped, "mdx").doc);

    const source = serializeDocument(
      { frontmatter: null, doc: editor.getJSON() as EditorDoc },
      "mdx",
    );

    expect(source).toBe("Text and <Badge count={3} /> more.\n");
  });

  it("restores frontmatter when saving from the editor", () => {
    const withFrontmatter = `---\ntitle: Hi\n---\n\n${SOURCE}`;
    const parsed = parseDocument(withFrontmatter, "mdx");
    const editor = load(parsed.doc);

    const source = serializeDocument(
      { frontmatter: parsed.frontmatter, doc: editor.getJSON() as EditorDoc },
      "mdx",
    );

    expect(source).toBe(withFrontmatter);
  });
});

describe("slash commands", () => {
  it("filters by title and lists everything for an empty query", () => {
    expect(filterCommands("")).toHaveLength(SLASH_COMMANDS.length);
    expect(filterCommands("head").map((item) => item.id)).toEqual([
      "heading1",
      "heading2",
      "heading3",
    ]);
    expect(filterCommands("nothing matches")).toEqual([]);
  });

  it("runs a command against the editor", () => {
    const editor = load({ type: "doc", content: [{ type: "paragraph" }] });
    const quote = SLASH_COMMANDS.find((item) => item.id === "blockquote");

    quote?.run(editor);

    expect(editor.isActive("blockquote")).toBe(true);
  });
});
