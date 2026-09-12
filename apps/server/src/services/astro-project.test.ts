import { describe, expect, it } from "vitest";
import { createFakeGitHubClient } from "../github/fake.ts";
import { createAstroProjectService } from "./astro-project.ts";
import { createRepositoryService } from "./repository.ts";

const CONTENT_CONFIG = `
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({ title: z.string(), draft: z.boolean().optional() }),
});
const docs = defineCollection({ type: "content" });

export const collections = { blog, docs };
`;

const ASTRO_FILES = {
  "package.json": JSON.stringify({ dependencies: { astro: "^5.4.0" } }),
  "astro.config.mjs": "export default {};\n",
  "src/content.config.ts": CONTENT_CONFIG,
  "src/content/blog/hello.md": "# Hello\n",
  "src/content/blog/nested/world.mdx": "# World\n",
  "src/content/blog/notes.txt": "not content",
  "src/content/docs/intro.md": "# Intro\n",
  "src/pages/index.astro": "<h1>Home</h1>\n",
};

function setup(files: Record<string, string> = ASTRO_FILES) {
  const fake = createFakeGitHubClient({ files });
  let reads = 0;
  const client = {
    ...fake.client,
    listFiles: (ref: string) => {
      reads += 1;
      return fake.client.listFiles(ref);
    },
  };
  const repository = createRepositoryService({
    github: client,
    baseBranch: "main",
  });
  return {
    fake,
    project: createAstroProjectService({ repository }),
    reads: () => reads,
  };
}

describe("discover", () => {
  it("verifies an Astro project and locates its configuration", async () => {
    const { fake, project } = setup();

    await expect(project.discover()).resolves.toMatchObject({
      headSha: fake.headOf("main"),
      isAstroProject: true,
      astroConfigPath: "astro.config.mjs",
      astroVersion: "^5.4.0",
      contentConfigPath: "src/content.config.ts",
      warnings: [],
    });
  });

  it("discovers collections with paths, formats, schema, and entry counts", async () => {
    const { project } = setup();

    const { collections } = await project.discover();

    expect(collections).toEqual([
      {
        name: "blog",
        loader: "glob",
        contentPath: "src/content/blog",
        pattern: "**/*.{md,mdx}",
        formats: ["md", "mdx"],
        entryCount: 2,
        schema: {
          inferred: true,
          fields: [
            { name: "title", type: "string", required: true },
            { name: "draft", type: "boolean", required: false },
          ],
        },
      },
      expect.objectContaining({
        name: "docs",
        contentPath: "src/content/docs",
        entryCount: 1,
      }),
    ]);
  });

  it("finds the legacy src/content/config.* location and says so", async () => {
    const rest = Object.fromEntries(
      Object.entries(ASTRO_FILES).filter(
        ([path]) => path !== "src/content.config.ts",
      ),
    );
    const { project } = setup({
      ...rest,
      "src/content/config.ts": CONTENT_CONFIG,
    });

    const result = await project.discover();

    expect(result.contentConfigPath).toBe("src/content/config.ts");
    expect(result.warnings).toEqual([
      "The content config is at the legacy location src/content/config.ts; Astro 5 uses src/content.config.ts.",
    ]);
    expect(result.collections).toHaveLength(2);
  });

  it("reports a project without a content config", async () => {
    const { project } = setup({
      "package.json": JSON.stringify({ devDependencies: { astro: "5.0.0" } }),
      "astro.config.ts": "export default {};\n",
    });

    const result = await project.discover();

    expect(result).toMatchObject({
      isAstroProject: true,
      astroConfigPath: "astro.config.ts",
      astroVersion: "5.0.0",
      contentConfigPath: null,
      collections: [],
    });
    expect(result.warnings).toEqual([
      "No src/content.config.* file found, so there are no content collections.",
    ]);
  });

  it("reports a repository that is not an Astro project", async () => {
    const { project } = setup({
      "README.md": "# Hi\n",
      "package.json": "{ not json",
    });

    const result = await project.discover();

    expect(result.isAstroProject).toBe(false);
    expect(result.astroVersion).toBeNull();
    expect(result.warnings).toContain(
      "No astro.config.* file and no astro dependency found. Is this an Astro project?",
    );
  });

  it("reuses the result until the base branch moves", async () => {
    const { fake, project, reads } = setup();

    await project.discover();
    await project.discover();
    expect(reads()).toBe(1);

    await fake.client.createBranch("cms/x", fake.headOf("main") ?? "");
    await fake.client.commit({
      branch: "cms/x",
      message: "x",
      changes: [{ path: "a.md", content: "a" }],
    });
    await project.discover();
    expect(reads()).toBe(1);
  });
});

describe("getCollection", () => {
  it("returns the collection with its editable entries", async () => {
    const { project } = setup();

    const result = await project.getCollection("blog");

    expect(result?.collection.name).toBe("blog");
    expect(result?.entries).toEqual([
      { path: "src/content/blog/hello.md", format: "md" },
      { path: "src/content/blog/nested/world.mdx", format: "mdx" },
    ]);
  });

  it("returns undefined for an unknown collection", async () => {
    const { project } = setup();

    await expect(project.getCollection("nope")).resolves.toBeUndefined();
  });
});
