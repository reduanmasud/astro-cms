import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database.ts";
import {
  createMediaRepository,
  type MediaRepository,
} from "../db/media-repository.ts";
import { createFakeGitHubClient, type FakeGitHub } from "../github/fake.ts";
import { createAstroProjectService } from "./astro-project.ts";
import { createRepositoryService } from "./repository.ts";
import {
  createMediaGitScanner,
  type MediaGitScanner,
} from "./media-git-scanner.ts";
import { TEST_CONTENT_CONFIG } from "../test-support/app.ts";

const PUBLIC_URL = "https://media.test";
const KEY = "media/ab/hero.png";
const URL = `${PUBLIC_URL}/${KEY}`;

describe("media git scanner", () => {
  let db: Db;
  let media: MediaRepository;
  let github: FakeGitHub;
  let scanner: MediaGitScanner;

  function build(files: Record<string, string>): void {
    github = createFakeGitHubClient({ files });
    const repository = createRepositoryService({
      github: github.client,
      baseBranch: "main",
    });
    scanner = createMediaGitScanner({
      repository: media,
      git: repository,
      project: createAstroProjectService({ repository }),
      publicUrl: PUBLIC_URL,
      baseBranch: "main",
    });
  }

  const astro = {
    "package.json": JSON.stringify({ dependencies: { astro: "^5.4.0" } }),
    "astro.config.mjs": "export default {};\n",
    "src/content.config.ts": TEST_CONTENT_CONFIG,
  };

  beforeEach(() => {
    db = openDatabase(":memory:");
    media = createMediaRepository(db);
    media.insert({
      id: "m1",
      objectKey: KEY,
      filename: "hero.png",
      contentType: "image/png",
      size: 10,
      sha256: "a".repeat(64),
      width: 1,
      height: 1,
      uploadedBy: null,
      uploadedAt: 1000,
    });
  });

  it("finds a reference on the base branch", async () => {
    build({ ...astro, "src/content/blog/hello.md": `![hero](${URL})\n` });

    const summary = await scanner.scan();

    expect(summary.references).toBe(1);
    expect(media.findById("m1")?.referenceCount).toBe(1);
    expect(media.listGitRefs()).toEqual(["main"]);
  });

  it("finds a reference on an open CMS branch", async () => {
    build(astro);
    await github.client.createBranch(
      "cms/blog/hello",
      github.headOf("main") ?? "",
    );
    await github.client.commit({
      branch: "cms/blog/hello",
      message: "add",
      changes: [
        { path: "src/content/blog/hello.md", content: `![hero](${URL})\n` },
      ],
    });
    await github.client.createPullRequest({
      head: "cms/blog/hello",
      base: "main",
      title: "CMS: blog/hello",
      body: "",
    });

    await scanner.scan();

    expect(media.findById("m1")?.referenceCount).toBe(1);
    expect(media.listGitRefs()).toContain("cms/blog/hello");
  });

  it("ignores files outside a collection's content path", async () => {
    build({ ...astro, "src/components/Hero.astro": `<img src="${URL}">` });

    await scanner.scan();

    expect(media.findById("m1")?.referenceCount).toBe(0);
  });

  it("does not read a ref whose head has not moved", async () => {
    build({ ...astro, "src/content/blog/hello.md": `![hero](${URL})\n` });
    await scanner.scan();

    const second = await scanner.scan();

    expect(second.read).toBe(0);
    expect(media.findById("m1")?.referenceCount).toBe(1);
  });

  it("re-reads a ref after its head moves", async () => {
    build({ ...astro, "src/content/blog/hello.md": `![hero](${URL})\n` });
    await scanner.scan();
    await github.client.commit({
      branch: "main",
      message: "drop the image",
      changes: [{ path: "src/content/blog/hello.md", content: "# Hi\n" }],
    });

    const second = await scanner.scan();

    expect(second.read).toBe(1);
    expect(media.findById("m1")?.referenceCount).toBe(0);
  });

  it("forgets a branch that no longer exists", async () => {
    build(astro);
    media.setGitReferences("cms/blog/gone", [
      { mediaId: "m1", path: "src/content/blog/gone.md" },
    ]);

    await scanner.scan();

    expect(media.listGitRefs()).not.toContain("cms/blog/gone");
    expect(media.findById("m1")?.referenceCount).toBe(0);
  });

  it("does nothing when media storage is off", async () => {
    build({ ...astro, "src/content/blog/hello.md": `![hero](${URL})\n` });
    const offline = createMediaGitScanner({
      repository: media,
      git: createRepositoryService({
        github: github.client,
        baseBranch: "main",
      }),
      project: createAstroProjectService({
        repository: createRepositoryService({
          github: github.client,
          baseBranch: "main",
        }),
      }),
      publicUrl: null,
      baseBranch: "main",
    });

    await expect(offline.scan()).resolves.toMatchObject({ references: 0 });
    expect(media.findById("m1")?.referenceCount).toBe(0);
  });
});
