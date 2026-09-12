import { Hono } from "hono";
import { SIGNATURE_HEADER } from "../collab/signature.ts";
import type { AuthEnv } from "../http/authenticate.ts";
import { apiError } from "../http/errors.ts";
import type { CollabService } from "../services/collab.ts";

/**
 * `/api/collab`: the webhook HocusPocus calls. It is public because the
 * caller is a server, not a browser session; every request must carry a valid
 * HMAC signature.
 */
export function collabRoutes(collab: CollabService): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.post("/webhook", async (c) => {
    if (!collab.isEnabled()) {
      return apiError(
        c,
        404,
        "collaboration_disabled",
        "Collaboration is not configured.",
      );
    }

    const result = await collab.handleWebhook({
      body: await c.req.text(),
      signature: c.req.header(SIGNATURE_HEADER),
    });
    return result.ok
      ? c.json(result.body as Record<string, unknown>, result.status)
      : apiError(c, result.status, "webhook_rejected", result.message);
  });

  return routes;
}
