import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import type { AuthEnv } from "../http/authenticate.ts";
import { apiError } from "../http/errors.ts";
import {
  clearSessionCookie,
  readSessionToken,
  writeSessionCookie,
  type CookieSettings,
} from "../http/session-cookie.ts";
import type { RateLimiter } from "../lib/rate-limiter.ts";
import type { Session, SessionService } from "../services/sessions.ts";

type Deps = {
  sessions: SessionService;
  loginLimiter: RateLimiter;
  cookie: CookieSettings;
};

/**
 * `/api/session`: log in, read the session, choose a display name, log out.
 * POST and DELETE are public; the rest sit behind `authenticate` (see app.ts).
 */
export function sessionRoutes({ sessions, loginLimiter, cookie }: Deps) {
  const routes = new Hono<AuthEnv>();

  routes.post("/", async (c) => {
    if (!c.req.header("Content-Type")?.startsWith("application/json")) {
      return apiError(
        c,
        415,
        "unsupported_media_type",
        "Send the request body as application/json.",
      );
    }
    const client = clientAddress(c);
    if (loginLimiter.isBlocked(client)) {
      return apiError(
        c,
        429,
        "rate_limited",
        "Too many failed login attempts. Try again later.",
      );
    }

    const password = stringField(await readJson(c), "password");
    if (password === undefined) {
      return apiError(
        c,
        400,
        "invalid_request",
        'Expected a "password" string.',
      );
    }

    const result = sessions.login({ password });
    if (!result.ok) {
      // Only failures count, so a team sharing one address is not locked out by normal use.
      loginLimiter.hit(client);
      return apiError(c, 401, "invalid_password", "Incorrect password.");
    }

    await writeSessionCookie(c, result.token, cookie);
    return c.json(toResponse(result.session));
  });

  routes.get("/", (c) => c.json(toResponse(c.var.session)));

  routes.put("/display-name", async (c) => {
    const name = stringField(await readJson(c), "name");
    const result =
      name === undefined
        ? ({ ok: false, reason: "invalid_display_name" } as const)
        : sessions.chooseDisplayName(c.var.sessionToken, name);

    if (result.ok) return c.json({ collaborator: result.collaborator });
    return result.reason === "unauthenticated"
      ? apiError(c, 401, "unauthenticated", "Sign in to continue.")
      : apiError(
          c,
          400,
          "invalid_display_name",
          "Display name must be 1–40 characters.",
        );
  });

  routes.delete("/", async (c) => {
    const token = await readSessionToken(c, cookie);
    if (token !== undefined) sessions.logout(token);
    clearSessionCookie(c, cookie);
    return c.body(null, 204);
  });

  return routes;
}

function toResponse(session: Session) {
  return { collaborator: session.collaborator };
}

async function readJson(c: Context): Promise<unknown> {
  return c.req.json<unknown>().catch(() => undefined);
}

function stringField(body: unknown, field: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/** The TCP peer address. Behind a reverse proxy this is the proxy for every client. */
function clientAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
