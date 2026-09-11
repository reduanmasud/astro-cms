import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { SESSION_TTL_MS } from "../services/sessions.ts";

const SESSION_COOKIE = "cms_session";

export interface CookieSettings {
  /** SESSION_SECRET. Signs the cookie so forged or tampered values are rejected. */
  secret: string;
  secure: boolean;
}

function baseOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: "Lax", secure, path: "/" };
}

/** Returns the session token when the cookie is present and correctly signed. */
export async function readSessionToken(
  c: Context,
  { secret }: CookieSettings,
): Promise<string | undefined> {
  const token = await getSignedCookie(c, secret, SESSION_COOKIE);
  return typeof token === "string" && token !== "" ? token : undefined;
}

export async function writeSessionCookie(
  c: Context,
  token: string,
  settings: CookieSettings,
): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE, token, settings.secret, {
    ...baseOptions(settings.secure),
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(
  c: Context,
  { secure }: CookieSettings,
): void {
  deleteCookie(c, SESSION_COOKIE, baseOptions(secure));
}
