import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/database.ts";
import {
  normalizeDisplayName,
  type Collaborator,
  type CollaboratorService,
} from "./collaborators.ts";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
  /** Null until the user chooses a display name after logging in. */
  readonly collaborator: Collaborator | null;
  readonly expiresAt: number;
}

export type LoginResult =
  | { readonly ok: true; readonly token: string; readonly session: Session }
  | { readonly ok: false; readonly reason: "invalid_password" };

export type ChooseDisplayNameResult =
  | { readonly ok: true; readonly collaborator: Collaborator }
  | {
      readonly ok: false;
      readonly reason: "invalid_display_name" | "unauthenticated";
    };

export interface SessionService {
  login(input: { password: string }): LoginResult;
  /** Looks up a live session and records collaborator activity. */
  resolve(token: string): Session | undefined;
  chooseDisplayName(token: string, name: string): ChooseDisplayNameResult;
  logout(token: string): void;
}

interface Deps {
  db: Db;
  password: string;
  collaborators: CollaboratorService;
  now?: () => number;
}

interface SessionRow {
  expires_at: number;
  collaborator_id: string | null;
  collaborator_name: string | null;
}

/**
 * Shared-password sessions. Only a SHA-256 hash of each token is stored; the
 * HTTP layer signs the token into the cookie with SESSION_SECRET.
 * See docs/adr/0009-minimal-authentication.md.
 */
export function createSessionService({
  db,
  password,
  collaborators,
  now = Date.now,
}: Deps): SessionService {
  const expectedPasswordHash = sha256(password);

  const insert = db.prepare(
    "INSERT INTO sessions (token_hash, collaborator_id, created_at, expires_at) VALUES (?, NULL, ?, ?)",
  );
  const selectLive = db.prepare<[string, number], SessionRow>(`
    SELECT s.expires_at, c.id AS collaborator_id, c.name AS collaborator_name
    FROM sessions s LEFT JOIN collaborators c ON c.id = s.collaborator_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  const assignCollaborator = db.prepare(
    "UPDATE sessions SET collaborator_id = ? WHERE token_hash = ? AND expires_at > ?",
  );
  const deleteByHash = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
  const deleteExpired = db.prepare(
    "DELETE FROM sessions WHERE expires_at <= ?",
  );

  // Expired rows are also purged on every login; this covers long gaps between logins.
  deleteExpired.run(now());

  function findRow(token: string): SessionRow | undefined {
    return selectLive.get(hashToken(token), now());
  }

  return {
    login({ password: attempt }) {
      // Compare fixed-length hashes so timing does not reveal the password length.
      if (!timingSafeEqual(sha256(attempt), expectedPasswordHash)) {
        return { ok: false, reason: "invalid_password" };
      }

      const createdAt = now();
      const token = randomBytes(32).toString("base64url");
      const session: Session = {
        collaborator: null,
        expiresAt: createdAt + SESSION_TTL_MS,
      };

      deleteExpired.run(createdAt);
      insert.run(hashToken(token), createdAt, session.expiresAt);
      return { ok: true, token, session };
    },

    resolve(token) {
      const row = findRow(token);
      if (!row) return undefined;

      const collaborator =
        row.collaborator_id !== null && row.collaborator_name !== null
          ? { id: row.collaborator_id, name: row.collaborator_name }
          : null;
      if (collaborator) collaborators.touch(collaborator.id);
      return { collaborator, expiresAt: row.expires_at };
    },

    chooseDisplayName(token, rawName) {
      const name = normalizeDisplayName(rawName);
      if (name === undefined)
        return { ok: false, reason: "invalid_display_name" };
      if (!findRow(token)) return { ok: false, reason: "unauthenticated" };

      const collaborator = collaborators.claim(name);
      assignCollaborator.run(collaborator.id, hashToken(token), now());
      return { ok: true, collaborator };
    },

    logout(token) {
      deleteByHash.run(hashToken(token));
    },
  };
}

function hashToken(token: string): string {
  return sha256(token).toString("hex");
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
