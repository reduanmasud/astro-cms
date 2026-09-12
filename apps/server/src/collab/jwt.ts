import { SignJWT, jwtVerify } from "jose";

/**
 * Short-lived tokens the browser (or MCP) presents to the HocusPocus server.
 * The CMS signs them; HocusPocus verifies them with the same secret
 * (HOCUSPOCUS_JWT_SECRET). The room is the `aud` claim, so a token for one
 * document cannot open another.
 */

export const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;
const ALGORITHM = "HS256";

export interface CollabTokenClaims {
  /** The room, which is the draft's id. */
  readonly room: string;
  readonly collaboratorId: string;
  readonly name: string;
}

export interface SignedCollabToken {
  readonly token: string;
  readonly expiresAt: number;
}

export interface SignTokenInput extends CollabTokenClaims {
  readonly secret: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export async function signCollabToken({
  secret,
  room,
  collaboratorId,
  name,
  ttlMs = DEFAULT_TOKEN_TTL_MS,
  now = Date.now,
}: SignTokenInput): Promise<SignedCollabToken> {
  const issuedAt = now();
  const expiresAt = issuedAt + ttlMs;

  const token = await new SignJWT({ name })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(collaboratorId)
    .setAudience(room)
    .setIssuedAt(Math.floor(issuedAt / 1000))
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(key(secret));

  return { token, expiresAt };
}

/** Returns the claims, or undefined when the token is invalid, expired, or for another room. */
export async function verifyCollabToken(
  token: string,
  secret: string,
  expectedRoom?: string,
): Promise<CollabTokenClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: [ALGORITHM],
      ...(expectedRoom === undefined ? {} : { audience: expectedRoom }),
    });
    const room = typeof payload.aud === "string" ? payload.aud : undefined;
    const collaboratorId = payload.sub;
    const name = payload.name;
    if (
      room === undefined ||
      collaboratorId === undefined ||
      typeof name !== "string"
    ) {
      return undefined;
    }
    return { room, collaboratorId, name };
  } catch {
    return undefined;
  }
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}
