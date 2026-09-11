import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Every API error uses this shape: `{ "error": { "code": "...", "message": "..." } }`. */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
): Response {
  return c.json({ error: { code, message } }, status);
}
