import { describe, expect, it } from "vitest";
import { createFakeGitHubClient, type FakeOptions } from "../github/fake.ts";
import { createRepositoryService, RepositoryError } from "./repository.ts";

const FILES = {
  "astro.config.mjs": "export default {};\n",
  "src/content/blog/hello.md": "# Hello\n",
};

function setup(options: FakeOptions = {}) {
  const fake = createFakeGitHubClient({ files: FILES, ...options });
  const repository = createRepositoryService({
    github: fake.client,
    baseBranch: "main",
  });
  return { fake, repository };
}

const save = {
  branch: "cms/blog/hello",
  message: "Update hello",
  changes: [{ path: "src/content/blog/hello.md", content: "# Hello, world\n" }],
  pullRequest: { title: "Update hello", body: "Published from Astro CMS." },
};

describe("verifyAccess", () => {
  it("returns the repository, base branch, and head commit", async () => {
    const { fake, repository } = setup();

    await expect(repository.verifyAccess()).resolves.toEqual({
      fullName: "acme/blog",
      baseBranch: "main",
      headSha: fake.headOf("main"),
    });
  });

  it("fails when the token cannot push", async () => {
    const { repository } = setup({ canPush: false });

    await expect(repository.verifyAccess()).rejects.toThrow(
      /cannot push to acme\/blog/,
    );
  });

  it("fails when the base branch does not exist", async () => {
    const fake = createFakeGitHubClient({ files: FILES });
    const repository = createRepositoryService({
      github: fake.client,
      baseBranch: "trunk",
    });

    await expect(repository.verifyAccess()).rejects.toThrow(
      /Base branch "trunk" does not exist/,
    );
  });

  it("explains authentication and not-found failures", async () => {
    const unauthorized = setup({ failWith: 401 }).repository;
    const missing = setup({ failWith: 404 }).repository;

    await expect(unauthorized.verifyAccess()).rejects.toThrow(
      /GITHUB_TOKEN was rejected/,
    );
    await expect(missing.verifyAccess()).rejects.toThrow(
      /not found or not visible/,
    );
  });
});

describe("reading", () => {
  it("lists and reads files on the base branch by default", async () => {
    const { repository } = setup();

    await expect(repository.listFiles()).resolves.toEqual(Object.keys(FILES));
    await expect(
      repository.readFile("src/content/blog/hello.md"),
    ).resolves.toBe("# Hello\n");
    await expect(repository.readFile("missing.md")).resolves.toBeUndefined();
  });

  it("reads at a specific ref", async () => {
    const { repository } = setup();
    await repository.saveToBranch(save);

    await expect(
      repository.readFile("src/content/blog/hello.md", "cms/blog/hello"),
    ).resolves.toBe("# Hello, world\n");
    await expect(
      repository.readFile("src/content/blog/hello.md"),
    ).resolves.toBe("# Hello\n");
  });

  it("rejects unsafe paths", async () => {
    const { repository } = setup();

    for (const path of ["", "/etc/passwd", "../secret", "a/../../b", "a\\b"]) {
      await expect(repository.readFile(path)).rejects.toBeInstanceOf(
        RepositoryError,
      );
    }
  });
});

describe("saveToBranch", () => {
  it("creates the branch from the base head, commits, and opens a pull request", async () => {
    const { fake, repository } = setup();
    const baseHead = fake.headOf("main");

    const result = await repository.saveToBranch(save);

    expect(result.createdBranch).toBe(true);
    expect(result.createdPullRequest).toBe(true);
    expect(result.commitSha).toBe(fake.headOf("cms/blog/hello"));
    expect(fake.parentOf(result.commitSha)).toBe(baseHead);
    expect(result.pullRequest).toMatchObject({
      head: "cms/blog/hello",
      base: "main",
      title: "Update hello",
      state: "open",
    });
  });

  it("updates the existing branch and pull request on later saves", async () => {
    const { fake, repository } = setup();
    const first = await repository.saveToBranch(save);

    const second = await repository.saveToBranch({
      ...save,
      message: "Fix typo",
      changes: [
        { path: "src/content/blog/hello.md", content: "# Hello, World\n" },
      ],
    });

    expect(second.createdBranch).toBe(false);
    expect(second.createdPullRequest).toBe(false);
    expect(second.pullRequest.number).toBe(first.pullRequest.number);
    expect(fake.parentOf(second.commitSha)).toBe(first.commitSha);
    expect(fake.pullRequestCount()).toBe(1);
  });

  it("never touches the base branch", async () => {
    const { fake, repository } = setup();
    const baseHead = fake.headOf("main");

    await repository.saveToBranch(save);

    expect(fake.headOf("main")).toBe(baseHead);
  });

  it.each(["main", "feature/x", "cms/", "cms/bad name", "cms/../main"])(
    'refuses to write to branch "%s"',
    async (branch) => {
      const { repository } = setup();

      await expect(
        repository.saveToBranch({ ...save, branch }),
      ).rejects.toBeInstanceOf(RepositoryError);
    },
  );

  it("refuses unsafe file paths", async () => {
    const { repository } = setup();

    await expect(
      repository.saveToBranch({
        ...save,
        changes: [{ path: "../x.md", content: "x" }],
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
  });

  it("refuses an empty change set", async () => {
    const { repository } = setup();

    await expect(
      repository.saveToBranch({ ...save, changes: [] }),
    ).rejects.toThrow(/No changes/);
  });

  it("refuses a CMS branch that exists without an open pull request", async () => {
    const { fake, repository } = setup();
    await repository.saveToBranch(save);
    fake.closeAllPullRequests();

    await expect(repository.saveToBranch(save)).rejects.toThrow(
      /has no open pull request/,
    );
  });

  it("deletes files when content is null", async () => {
    const { repository } = setup();

    await repository.saveToBranch({
      ...save,
      changes: [{ path: "src/content/blog/hello.md", content: null }],
    });

    await expect(
      repository.readFile("src/content/blog/hello.md", "cms/blog/hello"),
    ).resolves.toBeUndefined();
  });
});

describe("getPullRequest", () => {
  it("reads a pull request by number", async () => {
    const { repository } = setup();
    const { pullRequest } = await repository.saveToBranch(save);

    await expect(
      repository.getPullRequest(pullRequest.number),
    ).resolves.toEqual(pullRequest);
    await expect(repository.getPullRequest(999)).resolves.toBeUndefined();
  });
});
