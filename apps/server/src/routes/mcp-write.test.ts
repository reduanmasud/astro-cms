import { beforeEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  mcpCall,
  TEST_MCP_TOKEN,
  type TestApp,
} from "../test-support/app.ts";

interface Called {
  isError: boolean;
  text: string;
  json: <T>() => T;
}

describe("MCP write tools", () => {
  let harness: TestApp;

  beforeEach(() => {
    harness = buildTestApp({ mcpToken: TEST_MCP_TOKEN });
  });

  async function call(name: string, args: unknown): Promise<Called> {
    const { body } = await mcpCall(harness.app, TEST_MCP_TOKEN, "tools/call", {
      name,
      arguments: args,
    });
    const text = body?.result?.content?.[0]?.text ?? "";
    return {
      isError: body?.result?.isError === true,
      text,
      json: <T>() => JSON.parse(text) as T,
    };
  }

  async function draft(): Promise<string> {
    const created = await call("create_document", {
      collection: "blog",
      path: "src/content/blog/from-mcp.md",
    });
    return created.json<{ document: { id: string } }>().document.id;
  }

  it("creates, updates, and reads back a draft", async () => {
    const id = await draft();

    await call("update_document", { id, source: "# Written by a model\n" });
    const read = await call("get_document", { id });

    expect(read.json<{ source: string }>().source).toBe(
      "# Written by a model\n",
    );
  });

  it("attributes changes to the MCP collaborator", async () => {
    const id = await draft();

    const read = await call("get_document", { id });

    expect(read.json<{ createdBy: { name: string } }>().createdBy.name).toBe(
      "MCP",
    );
  });

  it("publishes, and publishing twice reuses the pull request", async () => {
    const id = await draft();
    await call("update_document", { id, source: "# Ready\n" });

    const first = await call("publish_document", { id });
    await call("update_document", { id, source: "# Ready again\n" });
    const second = await call("publish_document", { id });

    expect(
      first.json<{ createdPullRequest: boolean }>().createdPullRequest,
    ).toBe(true);
    expect(
      second.json<{ createdPullRequest: boolean }>().createdPullRequest,
    ).toBe(false);
    expect(harness.github.pullRequestCount()).toBe(1);
  });

  it("reports drift as a tool error and writes nothing", async () => {
    const id = await draft();
    await harness.github.client.commit({
      branch: "main",
      message: "someone else",
      changes: [{ path: "README.md", content: "hi" }],
    });

    const result = await call("publish_document", { id });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/base branch moved/i);
    expect(harness.github.pullRequestCount()).toBe(0);
  });

  it("re-syncs a drifted draft so it can publish", async () => {
    const id = await draft();
    await harness.github.client.commit({
      branch: "main",
      message: "someone else",
      changes: [{ path: "README.md", content: "hi" }],
    });

    await call("resync_document", { id });
    const result = await call("publish_document", { id });

    expect(result.isError).toBe(false);
    expect(harness.github.pullRequestCount()).toBe(1);
  });

  it("deletes a draft", async () => {
    const id = await draft();

    await call("delete_document", { id });
    const read = await call("get_document", { id });

    expect(read.isError).toBe(true);
  });
});
