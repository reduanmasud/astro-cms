import { Hono } from "hono";
import type { AuthEnv } from "../http/authenticate.ts";
import { apiError } from "../http/errors.ts";
import type { RepositoryService } from "../services/repository.ts";

/**
 * Extension to Content-Type, for files already in the repository (not our
 * own S3 media): an editor referencing an existing image by a relative or
 * root-relative path has no other way to see it, since that path means
 * nothing to this server's own origin. Same formats ADR-0017 accepts for
 * uploads, plus SVG — excluded there because a browser executes scripts in
 * an uploaded SVG opened directly; an `<img>` tag never does, and this
 * content is already trusted (whoever can commit it already has repo write
 * access, the same access GITHUB_TOKEN has).
 */
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

function contentTypeFor(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return undefined;
  return CONTENT_TYPES[path.slice(dot + 1).toLowerCase()];
}

/**
 * `/api/repo-asset`: serves a file already in the repository by path, for
 * images referenced from content that predates (or was never added
 * through) the CMS's own media system — those have no S3 URL to load from,
 * only a path meaningful inside the repository.
 */
export function assetRoutes(repository: RepositoryService): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.get("/", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "") {
      return apiError(
        c,
        400,
        "missing_path",
        'The "path" query parameter is required.',
      );
    }

    const contentType = contentTypeFor(path);
    if (contentType === undefined) {
      return apiError(
        c,
        415,
        "unsupported_type",
        "This file type cannot be served as an image.",
      );
    }

    const content = await repository.readBinaryFile(path);
    if (content === undefined) {
      return apiError(c, 404, "not_found", "No file at that path.");
    }

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        // Repository content, not content-addressed like S3 media: it can
        // change under the same path, so this caches briefly rather than
        // forever.
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  return routes;
}
