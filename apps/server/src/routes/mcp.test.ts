import { beforeEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  mcpCall,
  TEST_MCP_TOKEN,
  type TestApp,
} from "../test-support/app.ts";

describe("MCP endpoint", () => {
  let harness: TestApp;

  beforeEach(() => {
    harness = buildTestApp({ mcpToken: TEST_MCP_TOKEN });
  });

  it("advertises every tool with a schema", async () => {
    const { body } = await mcpCall(
      harness.app,
      TEST_MCP_TOKEN,
      "tools/list",
      {},
    );

    const tools = body?.result?.tools ?? [];
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("get_project");
    expect(names).toContain("list_documents");
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("reads the Astro project through the same service the UI uses", async () => {
    const { body } = await mcpCall(harness.app, TEST_MCP_TOKEN, "tools/call", {
      name: "get_project",
      arguments: {},
    });

    const text = body?.result?.content?.[0]?.text ?? "";
    expect(JSON.parse(text)).toMatchObject({ isAstroProject: true });
  });

  it("lists collections", async () => {
    const { body } = await mcpCall(harness.app, TEST_MCP_TOKEN, "tools/call", {
      name: "list_collections",
      arguments: {},
    });

    const collections = JSON.parse(
      body?.result?.content?.[0]?.text ?? "[]",
    ) as { name: string }[];
    expect(collections.map((c) => c.name)).toContain("blog");
  });

  it("reports an unknown document as a tool error, not a transport error", async () => {
    const { body } = await mcpCall(harness.app, TEST_MCP_TOKEN, "tools/call", {
      name: "get_document",
      arguments: { id: "missing" },
    });

    expect(body?.result?.isError).toBe(true);
    expect(body?.result?.content?.[0]?.text).toMatch(/no document/i);
  });

  it("refuses a wrong token", async () => {
    const response = await harness.app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(401);
  });

  it("refuses a missing token", async () => {
    const response = await harness.app.request("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(401);
  });

  it("answers 404 when MCP is not configured", async () => {
    const off = buildTestApp();

    const response = await off.app.request("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_MCP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(404);
    expect(
      ((await response.json()) as { error?: { code: string } }).error?.code,
    ).toBe("mcp_disabled");
  });
});
