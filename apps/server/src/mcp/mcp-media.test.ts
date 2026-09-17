import { describe, expect, it } from "vitest";
import { buildTestApp, TEST_MCP_TOKEN, mcpCall } from "../test-support/app.ts";

describe("MCP media tools", () => {
  async function setupWithMedia(): Promise<{
    mediaId: string;
    call: (
      toolName: string,
      params: unknown,
    ) => Promise<{
      isError: boolean;
      content?: { type: string; text: string }[];
    }>;
  }> {
    const testApp = buildTestApp({ mcpToken: TEST_MCP_TOKEN });
    const { app } = testApp;

    const call = async (
      toolName: string,
      params: unknown,
    ): Promise<{
      isError: boolean;
      content?: { type: string; text: string }[];
    }> => {
      const result = await mcpCall(app, TEST_MCP_TOKEN, "tools/call", {
        name: toolName,
        arguments: params,
      });
      return {
        isError: result.body?.result?.isError ?? false,
        content: result.body?.result?.content,
      };
    };

    // Upload a media file through the tool
    await call("upload_media", {
      url: "https://example.com/test.png",
      filename: "test.png",
    });

    // Get the media ID from list_media
    const listResult = await call("list_media", {});
    const listed = JSON.parse(
      listResult.content?.find((c) => c.type === "text")?.text ?? "[]",
    ) as { id: string }[];
    const mediaId = listed[0]?.id;

    if (!mediaId) {
      throw new Error("Failed to upload media");
    }

    return { mediaId, call };
  }

  function textOf(result: {
    content?: { type: string; text: string }[];
  }): string {
    const textContent = result.content?.find((c) => c.type === "text");
    return textContent?.text ?? "";
  }

  it("reports where a media file is used", async () => {
    const { call, mediaId } = await setupWithMedia();

    const result = await call("get_media_references", { id: mediaId });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ drafts: [], git: [] });
  });

  it("refuses references for a media file that does not exist", async () => {
    const { call } = await setupWithMedia();

    const result = await call("get_media_references", { id: "missing" });

    expect(result.isError).toBe(true);
  });
});
