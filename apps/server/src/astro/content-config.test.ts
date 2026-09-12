import { describe, expect, it } from "vitest";
import { parseContentConfig } from "./content-config.ts";

function collections(source: string) {
  return parseContentConfig(source).collections;
}

function fieldsOf(source: string) {
  const [first] = collections(source);
  if (!first?.schema.inferred) throw new Error("schema not inferred");
  return first.schema.fields;
}

const BLOG = `
import { defineCollection, z } from "astro:content";
import { glob, file } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/data/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string().optional(),
      pubDate: z.coerce.date(),
      updated: z.date().nullable(),
      heroImage: image().optional(),
      draft: z.boolean().default(false),
      tags: z.array(z.string()).default([]),
      category: z.enum(["news", "guide"]),
      author: reference("authors"),
      website: z.string().url().nullish(),
      rating: z.number().min(1).max(5),
    }),
});

const authors = defineCollection({
  loader: file("src/data/authors.json"),
  schema: z.object({ name: z.string() }),
});

export const collections = { blog, authors };
`;

describe("parseContentConfig", () => {
  it("finds collections from the exported object", () => {
    expect(collections(BLOG).map((c) => c.name)).toEqual(["blog", "authors"]);
  });

  it("reads glob loaders: base directory, pattern, and formats", () => {
    expect(collections(BLOG)[0]).toMatchObject({
      name: "blog",
      loader: "glob",
      contentPath: "src/data/blog",
      pattern: "**/*.{md,mdx}",
      formats: ["md", "mdx"],
    });
  });

  it("reads file loaders as data collections", () => {
    expect(collections(BLOG)[1]).toMatchObject({
      name: "authors",
      loader: "file",
      contentPath: "src/data/authors.json",
      formats: ["json"],
    });
  });

  it("extracts field types and required/optional", () => {
    expect(fieldsOf(BLOG)).toEqual([
      { name: "title", type: "string", required: true },
      { name: "description", type: "string", required: false },
      { name: "pubDate", type: "date", required: true },
      { name: "updated", type: "date", required: true, nullable: true },
      { name: "heroImage", type: "image", required: false },
      { name: "draft", type: "boolean", required: false, default: false },
      {
        name: "tags",
        type: "array",
        required: false,
        default: [],
        items: { type: "string" },
      },
      {
        name: "category",
        type: "enum",
        required: true,
        values: ["news", "guide"],
      },
      {
        name: "author",
        type: "reference",
        required: true,
        collection: "authors",
      },
      {
        name: "website",
        type: "string",
        required: false,
        nullable: true,
        format: "url",
      },
      { name: "rating", type: "number", required: true },
    ]);
  });

  it("supports legacy type: content collections under src/content/<name>", () => {
    const source = `
      import { defineCollection, z } from "astro:content";
      const docs = defineCollection({ type: "content", schema: z.object({ title: z.string() }) });
      const team = defineCollection({ type: "data", schema: z.object({ name: z.string() }) });
      export const collections = { docs, team };
    `;

    expect(collections(source)).toMatchObject([
      {
        name: "docs",
        loader: "legacy-content",
        contentPath: "src/content/docs",
        formats: ["md", "mdx"],
      },
      {
        name: "team",
        loader: "legacy-data",
        contentPath: "src/content/team",
        formats: ["json", "yaml"],
      },
    ]);
  });

  it("supports inline definitions, renamed keys, and quoted keys", () => {
    const source = `
      const posts = defineCollection({ loader: glob({ pattern: "*.md", base: "content/posts" }) });
      export const collections = {
        "news-items": defineCollection({ loader: glob({ pattern: ["**/*.md", "**/*.mdx"], base: "news/" }) }),
        blog: posts,
      };
    `;

    expect(collections(source)).toMatchObject([
      { name: "news-items", contentPath: "news", formats: ["md", "mdx"] },
      { name: "blog", contentPath: "content/posts", formats: ["md"] },
    ]);
  });

  it("follows `export { collections }` and `satisfies` wrappers", () => {
    const source = `
      const blog = defineCollection({ type: "content" });
      const collections = { blog } satisfies Record<string, unknown>;
      export { collections };
    `;

    expect(collections(source).map((c) => c.name)).toEqual(["blog"]);
  });

  it("resolves shared schema constants and nested objects", () => {
    const source = `
      const seo = z.object({ title: z.string(), noindex: z.boolean().optional() });
      const base = z.object({ title: z.string() });
      const blog = defineCollection({
        type: "content",
        schema: base.extend({ seo: seo.optional(), slugs: z.string().array() }),
      });
      export const collections = { blog };
    `;

    expect(fieldsOf(source)).toEqual([
      { name: "title", type: "string", required: true },
      {
        name: "seo",
        type: "object",
        required: false,
        fields: [
          { name: "title", type: "string", required: true },
          { name: "noindex", type: "boolean", required: false },
        ],
      },
      {
        name: "slugs",
        type: "array",
        required: true,
        items: { type: "string" },
      },
    ]);
  });

  it("marks every field optional after .partial()", () => {
    const source = `
      const blog = defineCollection({ type: "content", schema: z.object({ title: z.string() }).partial() });
      export const collections = { blog };
    `;

    expect(fieldsOf(source)).toEqual([
      { name: "title", type: "string", required: false },
    ]);
  });

  it("reports unknown field types instead of guessing", () => {
    const source = `
      const blog = defineCollection({
        type: "content",
        schema: z.object({ meta: z.record(z.string()), mixed: z.union([z.string(), z.number()]), custom: mySchema }),
      });
      export const collections = { blog };
    `;

    expect(fieldsOf(source)).toEqual([
      { name: "meta", type: "unknown", required: true },
      { name: "mixed", type: "union", required: true },
      { name: "custom", type: "unknown", required: true },
    ]);
  });

  it("explains when a schema cannot be inferred", () => {
    const source = `
      const blog = defineCollection({ type: "content", schema: buildSchema() });
      const notes = defineCollection({ type: "content" });
      export const collections = { blog, notes };
    `;

    expect(collections(source).map((c) => c.schema)).toEqual([
      {
        inferred: false,
        reason: "The schema is not a z.object(...) expression.",
      },
      { inferred: false, reason: "The collection has no schema." },
    ]);
  });

  it("marks custom loaders without guessing a path", () => {
    const source = `
      const products = defineCollection({ loader: myApiLoader(), schema: z.object({ sku: z.string() }) });
      export const collections = { products };
    `;

    expect(collections(source)[0]).toMatchObject({
      loader: "custom",
      contentPath: null,
      formats: [],
    });
  });

  it("returns a warning when there is no collections export", () => {
    expect(parseContentConfig("const x = 1;")).toEqual({
      collections: [],
      warnings: ["No `export const collections = { ... }` found."],
    });
  });

  it("returns a warning instead of throwing on a syntax error", () => {
    const result = parseContentConfig("export const collections = {");

    expect(result.collections).toEqual([]);
    expect(result.warnings[0]).toMatch(/Could not parse/);
  });

  it("never executes the config", () => {
    const source = `
      globalThis.__executed = true;
      export const collections = {};
    `;

    parseContentConfig(source);

    expect((globalThis as Record<string, unknown>).__executed).toBeUndefined();
  });
});
