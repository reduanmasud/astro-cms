import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requireCollaborator, type AuthEnv } from "../http/authenticate.ts";
import { apiError } from "../http/errors.ts";
import { MAX_UPLOAD_BYTES } from "../media/inspect.ts";
import type { MediaError, MediaService } from "../services/media.ts";
import type { MediaReferenceTracker } from "../services/media-references.ts";

/** Room for the multipart envelope around a maximum-size file. */
const BODY_LIMIT_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

interface Deps {
  media: MediaService;
  references: MediaReferenceTracker;
}

/**
 * `/api/media`: upload, list, inspect, and delete media. The browser never
 * sees storage credentials; it gets public URLs
 * (docs/adr/0017-media-storage.md).
 */
export function mediaRoutes({ media, references }: Deps): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const withName = requireCollaborator();

  routes.use(
    "*",
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) =>
        apiError(c, 413, "payload_too_large", "The file is too large."),
    }),
  );

  routes.use(
    "*",
    createMiddleware<AuthEnv>(async (c, next) => {
      if (!media.isEnabled()) {
        return apiError(
          c,
          404,
          "media_disabled",
          "Media storage is not configured.",
        );
      }
      await next();
    }),
  );

  routes.post("/", withName, async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return apiError(
        c,
        400,
        "invalid_request",
        'Send the image as a "file" form field.',
      );
    }

    const uploaded = await media.upload(
      { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
      c.var.session.collaborator,
    );
    return c.json(uploaded, uploaded.created ? 201 : 200);
  });

  routes.get("/", (c) => {
    const url = new URL(c.req.url);
    // Reference counts drive the "unused" view, so refresh them first.
    references.recompute();
    return c.json({
      media: media.list({
        unusedOnly: url.searchParams.get("unused") === "true",
        limit: numberParam(url.searchParams.get("limit")),
        offset: numberParam(url.searchParams.get("offset")),
      }),
    });
  });

  routes.get("/:id", async (c) => {
    const item = media.get(c.req.param("id"));
    if (c.req.query("verify") !== "true") return c.json({ media: item });

    const head = await media.verify(item.id);
    return c.json({
      media: item,
      storage: head ?? null,
      exists: head !== undefined,
    });
  });

  routes.get("/:id/references", (c) =>
    c.json({ references: media.references(c.req.param("id")) }),
  );

  routes.delete("/:id", withName, async (c) => {
    references.recompute();
    await media.delete(c.req.param("id"));
    return c.body(null, 204);
  });

  return routes;
}

/** Maps a MediaError to its HTTP status and body. */
export function mediaErrorResponse(c: Context, error: MediaError): Response {
  const statuses: Record<MediaError["code"], ContentfulStatusCode> = {
    not_configured: 404,
    invalid: 400,
    empty: 400,
    too_large: 413,
    unsupported_type: 415,
    not_found: 404,
    in_use: 409,
  };
  return c.json(
    { error: { code: error.code, message: error.message } },
    statuses[error.code],
  );
}

function numberParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}
