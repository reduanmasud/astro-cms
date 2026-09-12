import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireCollaborator, type AuthEnv } from "../http/authenticate.ts";
import { apiError } from "../http/errors.ts";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DocumentError } from "../services/documents.ts";
import {
  type DocumentErrorCode,
  type DocumentService,
} from "../services/documents.ts";
import type { DraftOpener } from "../services/draft-opener.ts";
import { MAX_SOURCE_BYTES } from "../services/documents.ts";

const BODY_LIMIT_BYTES = 2 * MAX_SOURCE_BYTES;

interface Deps {
  documents: DocumentService;
  drafts: DraftOpener;
}

/** `/api/documents`: drafts in SQLite. Nothing here writes to GitHub. */
export function documentRoutes({ documents, drafts }: Deps): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const withName = requireCollaborator();

  routes.use(
    "*",
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) =>
        apiError(c, 413, "payload_too_large", "The document is too large."),
    }),
  );

  routes.get("/", (c) => {
    const url = new URL(c.req.url);
    const search = url.searchParams.get("q") ?? undefined;
    const options = {
      collection: url.searchParams.get("collection") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: numberParam(url.searchParams.get("limit")),
      offset: numberParam(url.searchParams.get("offset")),
    } as Parameters<DocumentService["list"]>[0];

    const list =
      search === undefined
        ? documents.list(options)
        : documents.search(search, options);
    return c.json({ documents: list });
  });

  routes.post("/", withName, async (c) => {
    const body = await readJson(c);
    const collection = stringField(body, "collection");
    const path = stringField(body, "path");
    if (collection === undefined || path === undefined) {
      return apiError(
        c,
        400,
        "invalid_request",
        'Expected "collection" and "path" strings.',
      );
    }

    const { document, created } = await drafts.open(
      { collection, path },
      c.var.session.collaborator,
    );
    return c.json({ document, created }, created ? 201 : 200);
  });

  routes.get("/:id", (c) =>
    c.json({ document: documents.get(c.req.param("id")) }),
  );

  routes.patch("/:id", withName, async (c) => {
    const body = await readJson(c);
    if (typeof body !== "object" || body === null) {
      return apiError(c, 400, "invalid_request", "Expected a JSON object.");
    }
    const { source, slug, status, expectedRevision } = body as Record<
      string,
      unknown
    >;
    if (
      (source !== undefined && typeof source !== "string") ||
      (slug !== undefined && typeof slug !== "string") ||
      (status !== undefined && typeof status !== "string") ||
      (expectedRevision !== undefined && !Number.isInteger(expectedRevision))
    ) {
      return apiError(c, 400, "invalid_request", "A field has the wrong type.");
    }

    const document = documents.update(
      c.req.param("id"),
      { source, slug, status, expectedRevision } as Parameters<
        DocumentService["update"]
      >[1],
      c.var.session.collaborator,
    );
    return c.json({ document });
  });

  routes.delete("/:id", withName, (c) => {
    documents.delete(c.req.param("id"));
    return c.body(null, 204);
  });

  return routes;
}

/** Maps a DocumentError to its HTTP status and body. */
export function documentErrorResponse(
  c: Context,
  error: DocumentError,
): Response {
  const statuses: Record<DocumentErrorCode, ContentfulStatusCode> = {
    invalid: 400,
    not_found: 404,
    already_exists: 409,
    conflict: 409,
  };
  const status = statuses[error.code];

  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.currentRevision === undefined
          ? {}
          : { currentRevision: error.currentRevision }),
      },
    },
    status,
  );
}

function numberParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  // Anything non-numeric becomes NaN, which the service rejects as invalid.
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

async function readJson(c: Context): Promise<unknown> {
  return c.req.json<unknown>().catch(() => undefined);
}

function stringField(body: unknown, field: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}
