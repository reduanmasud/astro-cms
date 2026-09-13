import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { AuthEnv } from "../http/authenticate.ts";
import { apiError } from "../http/errors.ts";
import type { McpHandler } from "../mcp/server.ts";

interface Deps {
  /** Null switches MCP off: the route answers 404. */
  token: string | null;
  handler: McpHandler;
}

const BEARER = "Bearer ";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Compared as hashes, so the check is constant time whatever the lengths. */
function authorized(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith(BEARER)) return false;
  return timingSafeEqual(sha256(header.slice(BEARER.length)), sha256(token));
}

/**
 * `/api/mcp`: the CMS spoken to by a model. Guarded by its own bearer token,
 * never by the browser session (docs/superpowers/specs/2026-09-13-mcp-design.md).
 */
export function mcpRoutes({ token, handler }: Deps): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.all("/", async (c) => {
    if (token === null) {
      return apiError(c, 404, "mcp_disabled", "MCP is not configured.");
    }
    if (!authorized(c.req.header("Authorization"), token)) {
      return apiError(
        c,
        401,
        "unauthenticated",
        "Provide the MCP token as a bearer token.",
      );
    }
    return handler.fetch(c.req.raw);
  });

  return routes;
}
