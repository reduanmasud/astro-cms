import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { Session, SessionService } from "../services/sessions.ts";
import { apiError } from "./errors.ts";
import { readSessionToken, type CookieSettings } from "./session-cookie.ts";

export interface AuthEnv {
  Variables: {
    session: Session;
    sessionToken: string;
  };
}

/** Rejects requests without a valid session; otherwise exposes it as `c.var.session`. */
export function authenticate(
  sessions: SessionService,
  cookie: CookieSettings,
): MiddlewareHandler<AuthEnv> {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = await readSessionToken(c, cookie);
    const session = token === undefined ? undefined : sessions.resolve(token);
    if (token === undefined || session === undefined) {
      return apiError(c, 401, "unauthenticated", "Sign in to continue.");
    }

    c.set("session", session);
    c.set("sessionToken", token);
    await next();
  });
}
