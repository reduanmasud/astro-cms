import { Hono } from "hono";
import { except } from "hono/combine";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { GitHubError } from "./github/client.ts";
import { authenticate, type AuthEnv } from "./http/authenticate.ts";
import { apiError } from "./http/errors.ts";
import type { RateLimiter } from "./lib/rate-limiter.ts";
import { collabRoutes } from "./routes/collab.ts";
import { collectionRoutes } from "./routes/collections.ts";
import { mediaErrorResponse, mediaRoutes } from "./routes/media.ts";
import {
  documentErrorResponse,
  documentRoutes,
  publishErrorResponse,
} from "./routes/documents.ts";
import { sessionRoutes } from "./routes/session.ts";
import type { AstroProjectService } from "./services/astro-project.ts";
import type { CollabService } from "./services/collab.ts";
import { MediaError, type MediaService } from "./services/media.ts";
import type { MediaReferenceTracker } from "./services/media-references.ts";
import { DocumentError, type DocumentService } from "./services/documents.ts";
import type { DraftOpener } from "./services/draft-opener.ts";
import type { ImageFetcher } from "./mcp/fetch-image.ts";
import { createCmsMcpHandler } from "./mcp/server.ts";
import { mcpRoutes } from "./routes/mcp.ts";
import type { CollaboratorService } from "./services/collaborators.ts";
import type { HealthService } from "./services/health.ts";
import { PublishError, type PublishService } from "./services/publish.ts";
import type { RepositoryService } from "./services/repository.ts";
import type { SessionService } from "./services/sessions.ts";

export interface AppDeps {
  health: HealthService;
  repository: RepositoryService;
  project: AstroProjectService;
  documents: DocumentService;
  drafts: DraftOpener;
  publish: PublishService;
  collab: CollabService;
  media: MediaService;
  mediaReferences: MediaReferenceTracker;
  sessions: SessionService;
  collaborators: CollaboratorService;
  loginLimiter: RateLimiter;
  sessionSecret: string;
  cookieSecure: boolean;
  /** Fetches an image by URL for MCP's upload_media. */
  fetchImage: ImageFetcher;
  /** Null switches the MCP endpoint off. */
  mcpToken: string | null;
}

/**
 * Everything under /api requires a session except these. New routes are
 * protected by default; making one public means adding it here.
 */
const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/session",
  "DELETE /api/session",
  // HocusPocus calls this server-to-server; every request is HMAC-signed.
  "POST /api/collab/webhook",
]);

/**
 * Wires HTTP interfaces to services. Routes stay thin: authenticate, validate,
 * call a service, format the result (docs/adr/0011-shared-service-layer.md).
 */
export function createApp({
  health,
  repository,
  project,
  documents,
  drafts,
  publish,
  collab,
  media,
  mediaReferences,
  sessions,
  collaborators,
  loginLimiter,
  sessionSecret,
  cookieSecure,
  fetchImage,
  mcpToken,
}: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const cookie = { secret: sessionSecret, secure: cookieSecure };
  const requireSession = authenticate(sessions, cookie);

  // MCP is not browser-driven: it carries a bearer token, so neither the
  // cookie nor the CSRF check applies to it. The session exemption is
  // required (an MCP client has no cookie); the CSRF one is defence in depth,
  // since csrf() already allows the application/json MCP sends.
  const isMcp = (path: string): boolean => path === "/api/mcp";

  app.use(
    "/api/*",
    except((c) => isMcp(c.req.path), csrf()),
  );
  app.use(
    "/api/*",
    except(
      (c) =>
        PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`) || isMcp(c.req.path),
      requireSession,
    ),
  );

  app.get("/api/health", (c) =>
    health.isHealthy() ? c.json({ ok: true }) : c.json({ ok: false }, 503),
  );
  app.get("/api/repository", async (c) => c.json(await repository.getStatus()));
  app.route("/api/collab", collabRoutes(collab));
  app.route("/api/collections", collectionRoutes(project));
  app.route(
    "/api/documents",
    documentRoutes({ documents, drafts, collab, publish }),
  );
  app.route("/api/media", mediaRoutes({ media, references: mediaReferences }));
  app.route(
    "/api/mcp",
    mcpRoutes({
      token: mcpToken,
      handler: createCmsMcpHandler({
        project,
        documents,
        drafts,
        publish,
        media,
        repository,
        collaborators,
        fetchImage,
      }),
    }),
  );
  app.route("/api/session", sessionRoutes({ sessions, loginLimiter, cookie }));
  app.all("/api/*", (c) => apiError(c, 404, "not_found", "No such API route."));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof DocumentError) return documentErrorResponse(c, error);
    if (error instanceof PublishError) return publishErrorResponse(c, error);
    if (error instanceof MediaError) return mediaErrorResponse(c, error);
    if (error instanceof GitHubError) {
      return apiError(c, 502, "github_unavailable", error.message);
    }
    console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, error);
    return apiError(c, 500, "internal_error", "Something went wrong.");
  });

  return app;
}
