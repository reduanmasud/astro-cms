import { describe, expect, it } from "vitest";
import { createFakeGitHubClient } from "./fake.ts";

describe("fake GitHub client", () => {
  it("marks a pull request merged", async () => {
    const github = createFakeGitHubClient();
    await github.client.createBranch(
      "cms/blog/hello",
      github.headOf("main") ?? "",
    );
    const pr = await github.client.createPullRequest({
      head: "cms/blog/hello",
      base: "main",
      title: "CMS: blog/hello",
      body: "",
    });

    github.mergePullRequest(pr.number);

    await expect(
      github.client.getPullRequest(pr.number),
    ).resolves.toMatchObject({
      state: "closed",
      merged: true,
    });
    await expect(
      github.client.findOpenPullRequest("cms/blog/hello"),
    ).resolves.toBeUndefined();
  });
});
