import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerTools, type McpDeps } from "./tools.ts";

export interface McpHandler {
  fetch(request: Request): Promise<Response>;
}

/**
 * The CMS as an MCP server, stateless: the factory runs per request, so no
 * session state is kept between calls.
 */
export function createCmsMcpHandler(deps: McpDeps): McpHandler {
  return createMcpHandler(() => {
    const server = new McpServer(
      { name: "astro-cms", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    registerTools(server, deps);
    return server;
  });
}
