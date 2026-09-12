import { Hono } from "hono";
import { except } from "hono/combine";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { GitHubError } from "./github/client.ts";
import { authenticate, type AuthEnv } from "./http/authenticate.ts";
import { apiError } from "./http/errors.ts";
import type { RateLimiter } from "./lib/rate-limiter.ts";
import { collectionRoutes } from "./routes/collections.ts";
import { documentErrorResponse, documentRoutes } from "./routes/documents.ts";
import { sessionRoutes } from "./routes/session.ts";
import type { AstroProjectService } from "./services/astro-project.ts";
import { DocumentError, type DocumentService } from "./services/documents.ts";
import type { DraftOpener } from "./services/draft-opener.ts";
import type { HealthService } from "./services/health.ts";
import type { RepositoryService } from "./services/repository.ts";
import type { SessionService } from "./services/sessions.ts";

export interface AppDeps {
  health: HealthService;
  repository: RepositoryService;
  project: AstroProjectService;
  documents: DocumentService;
  drafts: DraftOpener;
  sessions: SessionService;
  loginLimiter: RateLimiter;
  sessionSecret: string;
  cookieSecure: boolean;
}

/**
 * Everything under /api requires a session except these. New routes are
 * protected by default; making one public means adding it here.
 */
const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/session",
  "DELETE /api/session",
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
  sessions,
  loginLimiter,
  sessionSecret,
  cookieSecure,
}: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const cookie = { secret: sessionSecret, secure: cookieSecure };
  const requireSession = authenticate(sessions, cookie);

  app.use("/api/*", csrf());
  app.use(
    "/api/*",
    except(
      (c) => PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`),
      requireSession,
    ),
  );

  app.get("/api/health", (c) =>
    health.isHealthy() ? c.json({ ok: true }) : c.json({ ok: false }, 503),
  );
  app.get("/api/repository", async (c) => c.json(await repository.getStatus()));
  app.route("/api/collections", collectionRoutes(project));
  app.route("/api/documents", documentRoutes({ documents, drafts }));
  app.route("/api/session", sessionRoutes({ sessions, loginLimiter, cookie }));
  app.all("/api/*", (c) => apiError(c, 404, "not_found", "No such API route."));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof DocumentError) return documentErrorResponse(c, error);
    if (error instanceof GitHubError) {
      return apiError(c, 502, "github_unavailable", error.message);
    }
    console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, error);
    return apiError(c, 500, "internal_error", "Something went wrong.");
  });

  return app;
}
