import { beforeEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  mcpCall,
  TEST_MCP_TOKEN,
  type TestApp,
} from "../test-support/app.ts";

describe("MCP media tools", () => {
  let harness: TestApp;

  beforeEach(() => {
    harness = buildTestApp({ mcpToken: TEST_MCP_TOKEN });
  });

  async function call(
    name: string,
    args: unknown,
  ): Promise<{ isError: boolean; text: string }> {
    const { body } = await mcpCall(harness.app, TEST_MCP_TOKEN, "tools/call", {
      name,
      arguments: args,
    });
    return {
      isError: body?.result?.isError === true,
      text: body?.result?.content?.[0]?.text ?? "",
    };
  }

  it("uploads an image from a URL and returns where it now lives", async () => {
    const result = await call("upload_media", {
      url: "https://example.com/hero.png",
    });

    const { media } = JSON.parse(result.text) as {
      media: { url: string; contentType: string; width: number };
    };
    expect(media.contentType).toBe("image/png");
    expect(media.url).toMatch(/^https:\/\/media\.test\//);
    expect(harness.mediaStorage.keys()).toHaveLength(1);
  });

  it("lists and reads media back", async () => {
    await call("upload_media", { url: "https://example.com/hero.png" });

    const listed = await call("list_media", {});
    const items = JSON.parse(listed.text) as { id: string }[];
    const read = await call("get_media", { id: items[0]?.id ?? "" });

    expect(items).toHaveLength(1);
    expect(JSON.parse(read.text)).toMatchObject({ contentType: "image/png" });
  });

  it("deletes an unused file", async () => {
    await call("upload_media", { url: "https://example.com/hero.png" });
    const items = JSON.parse((await call("list_media", {})).text) as {
      id: string;
    }[];

    await call("delete_media", { id: items[0]?.id ?? "" });

    expect(harness.mediaStorage.keys()).toEqual([]);
  });

  it("reports storage being switched off as a tool error", async () => {
    const off = buildTestApp({ mcpToken: TEST_MCP_TOKEN, mediaEnabled: false });

    const { body } = await mcpCall(off.app, TEST_MCP_TOKEN, "tools/call", {
      name: "upload_media",
      arguments: { url: "https://example.com/hero.png" },
    });

    expect(body?.result?.isError).toBe(true);
    expect(body?.result?.content?.[0]?.text).toMatch(/not configured/i);
  });
});
