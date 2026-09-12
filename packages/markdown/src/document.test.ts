import { describe, expect, it } from "vitest";
import { parseDocument, serializeDocument } from "./index.ts";
import type { EditorNode } from "./model.ts";

/** Parses, then serializes again: the source a round trip produces. */
function roundTrip(source: string, format: "md" | "mdx" = "md"): string {
  return serializeDocument(parseDocument(source, format), format);
}

function blocks(
  source: string,
  format: "md" | "mdx" = "md",
): readonly EditorNode[] {
  return parseDocument(source, format).doc.content;
}

describe("frontmatter", () => {
  it("is kept out of the editor document and written back unchanged", () => {
    const source = "---\ntitle: Hello\ntags:\n  - a\n---\n\n# Hi\n";

    const parsed = parseDocument(source, "md");

    expect(parsed.frontmatter).toBe("title: Hello\ntags:\n  - a");
    expect(parsed.doc.content[0]).toMatchObject({ type: "heading" });
    expect(serializeDocument(parsed, "md")).toBe(source);
  });

  it("is absent when the file has none", () => {
    expect(parseDocument("# Hi\n", "md").frontmatter).toBeNull();
  });

  it("can be empty", () => {
    expect(roundTrip("---\n---\n\n# Hi\n")).toBe("---\n---\n\n# Hi\n");
  });
});

describe("block content", () => {
  it.each([
    ["headings", "# One\n\n## Two\n\n### Three\n"],
    ["paragraphs", "First paragraph.\n\nSecond paragraph.\n"],
    ["blockquote", "> Quoted text\n"],
    ["horizontal rule", "Above\n\n---\n\nBelow\n"],
    ["bullet list", "- one\n- two\n"],
    ["ordered list", "1. one\n2. two\n"],
    ["nested list", "- one\n  - nested\n- two\n"],
    ["ordered list with start", "3. three\n4. four\n"],
    ["code block", "```ts\nconst x = 1;\n```\n"],
    ["code block without language", "```\nplain\n```\n"],
    ["hard break", "one\\\ntwo\n"],
  ])("round-trips %s", (_label, source) => {
    expect(roundTrip(source)).toBe(source);
  });

  it("maps headings to editor nodes with levels", () => {
    expect(blocks("## Two\n")[0]).toMatchObject({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Two" }],
    });
  });

  it("maps code blocks with their language", () => {
    expect(blocks("```ts\nconst x = 1;\n```\n")[0]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
  });

  it("keeps the ordered list start number", () => {
    expect(blocks("3. three\n")[0]).toMatchObject({
      type: "orderedList",
      attrs: { start: 3 },
    });
  });
});

describe("inline marks", () => {
  it.each([
    ["bold", "**bold**"],
    ["italic", "_italic_"],
    ["strike", "~~struck~~"],
    ["inline code", "`code()`"],
    ["link", "[text](https://example.com)"],
    ["link with title", '[text](https://example.com "Title")'],
    ["combined", "**bold _and italic_**"],
  ])("round-trips %s", (_label, inline) => {
    expect(roundTrip(`${inline}\n`)).toBe(`${inline}\n`);
  });

  it("maps marks onto text nodes", () => {
    const paragraph = blocks("**bold** and `code`\n")[0];

    expect(paragraph).toMatchObject({
      type: "paragraph",
      content: [
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " and " },
        { type: "text", text: "code", marks: [{ type: "code" }] },
      ],
    });
  });

  it("maps links with href and title", () => {
    const [text] = (blocks('[t](https://example.com "T")\n')[0]?.content ??
      []) as EditorNode[];

    expect(text?.marks?.[0]).toEqual({
      type: "link",
      attrs: { href: "https://example.com", title: "T" },
    });
  });
});

describe("whitespace in marks", () => {
  const paragraph = (text: string) => ({
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "before" },
          { type: "text", text, marks: [{ type: "bold" }] },
          { type: "text", text: "after" },
        ],
      },
    ],
  });

  it("moves a trailing space outside the mark instead of escaping it", () => {
    expect(
      serializeDocument({ frontmatter: null, doc: paragraph("bold ") }, "md"),
    ).toBe("before**bold** after\n");
  });

  it("moves a leading space outside the mark", () => {
    expect(
      serializeDocument({ frontmatter: null, doc: paragraph(" bold") }, "md"),
    ).toBe("before **bold**after\n");
  });

  it("drops a mark that contains only spaces", () => {
    expect(
      serializeDocument({ frontmatter: null, doc: paragraph(" ") }, "md"),
    ).toBe("before after\n");
  });

  it("still escapes a space at the very start of a paragraph, as Markdown requires", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: " x", marks: [{ type: "bold" }] }],
        },
      ],
    };

    expect(serializeDocument({ frontmatter: null, doc }, "md")).toBe(
      "&#x20;**x**\n",
    );
  });
});

describe("tables", () => {
  const table = "| a | b |\n| - | - |\n| 1 | 2 |\n";

  it("round-trips a table", () => {
    expect(roundTrip(table)).toBe(table);
  });

  it("maps rows and header cells", () => {
    expect(blocks(table)[0]).toMatchObject({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableHeader" }, { type: "tableHeader" }],
        },
        {
          type: "tableRow",
          content: [{ type: "tableCell" }, { type: "tableCell" }],
        },
      ],
    });
  });

  it("keeps column alignment", () => {
    const aligned = "| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n";

    expect(roundTrip(aligned)).toBe(aligned);
  });
});

describe("MDX", () => {
  it("keeps imports and exports as protected blocks", () => {
    const source =
      'import Chart from "../components/Chart.astro";\n\n# Title\n';

    const [first] = blocks(source, "mdx");

    expect(first).toEqual({
      type: "mdxBlock",
      attrs: {
        kind: "esm",
        source: 'import Chart from "../components/Chart.astro";',
      },
    });
    expect(roundTrip(source, "mdx")).toBe(source);
  });

  it("keeps JSX components byte-for-byte, including children and attributes", () => {
    const component =
      '<Chart\n  data={[1, 2, 3]}\n  title="Growth"\n>\n  <span>inner</span>\n</Chart>';
    const source = `# Title\n\n${component}\n\nAfter.\n`;

    const parsed = parseDocument(source, "mdx");

    expect(parsed.doc.content[1]).toEqual({
      type: "mdxBlock",
      attrs: { kind: "jsx", source: component },
    });
    expect(serializeDocument(parsed, "mdx")).toBe(source);
  });

  it("keeps inline JSX and expressions inside paragraphs", () => {
    const source = "Hello <Badge count={3} /> and {frontmatter.title}.\n";

    const paragraph = blocks(source, "mdx")[0];

    expect(paragraph?.content).toEqual([
      { type: "text", text: "Hello " },
      { type: "mdxInline", attrs: { source: "<Badge count={3} />" } },
      { type: "text", text: " and " },
      { type: "mdxInline", attrs: { source: "{frontmatter.title}" } },
      { type: "text", text: "." },
    ]);
    expect(roundTrip(source, "mdx")).toBe(source);
  });

  it("keeps expression blocks", () => {
    const source = "{/* a comment */}\n";

    expect(blocks(source, "mdx")[0]).toMatchObject({
      type: "mdxBlock",
      attrs: { kind: "expression" },
    });
    expect(roundTrip(source, "mdx")).toBe(source);
  });

  it("treats JSX in plain Markdown as raw HTML and keeps it", () => {
    const source = "<div class='note'>\n  Raw HTML\n</div>\n";

    expect(blocks(source)[0]).toEqual({
      type: "mdxBlock",
      attrs: { kind: "html", source: "<div class='note'>\n  Raw HTML\n</div>" },
    });
    expect(roundTrip(source)).toBe(source);
  });

  it("keeps unsupported constructs such as images and footnotes", () => {
    const image = "![alt](./hero.png)\n";
    const footnote = "Text[^1]\n\n[^1]: The note\n";

    expect(roundTrip(image)).toBe(image);
    expect(roundTrip(footnote)).toBe(footnote);
  });

  it("never loses content: a second round trip is identical", () => {
    const source = [
      "---",
      "title: Everything",
      "---",
      "",
      'import Chart from "../Chart.astro";',
      "",
      "# Heading",
      "",
      "Text with **bold**, a [link](https://example.com) and <Badge x={1} />.",
      "",
      "> quote",
      "",
      "- list",
      "  - nested",
      "",
      "```js",
      "code();",
      "```",
      "",
      "<Chart data={[1]} />",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
    ].join("\n");

    const once = roundTrip(source, "mdx");

    expect(once).toBe(source);
    expect(roundTrip(once, "mdx")).toBe(once);
  });
});

describe("serializeDocument", () => {
  it("writes an empty document as an empty string", () => {
    expect(
      serializeDocument(
        { frontmatter: null, doc: { type: "doc", content: [] } },
        "md",
      ),
    ).toBe("");
  });

  it("ignores unknown node types instead of throwing", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "somethingNew", content: [{ type: "text", text: "kept" }] },
      ],
    } as const;

    expect(serializeDocument({ frontmatter: null, doc }, "md")).toBe("kept\n");
  });
});
