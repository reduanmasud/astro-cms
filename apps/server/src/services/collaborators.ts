import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.ts";

/** How stale last_seen_at may get before a request writes a new value. */
export const LAST_SEEN_THROTTLE_MS = 60 * 1000;
const MAX_NAME_LENGTH = 40;

/**
 * A lightweight identity: a display name, not an account. Anyone who knows
 * the CMS password can use any name (docs/adr/0009-minimal-authentication.md).
 */
export interface Collaborator {
  readonly id: string;
  readonly name: string;
}

export interface CollaboratorService {
  /** Returns the collaborator with this name (case-insensitive), creating it if needed. */
  claim(name: string): Collaborator;
  /** Records activity, writing at most once per LAST_SEEN_THROTTLE_MS. */
  touch(id: string): void;
}

interface Deps {
  db: Db;
  now?: () => number;
}

/** Trims a display name; returns undefined when it is empty, too long, or has control characters. */
export function normalizeDisplayName(value: string): string | undefined {
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return undefined;
  if (/\p{Cc}/u.test(name)) return undefined;
  return name;
}

export function createCollaboratorService({
  db,
  now = Date.now,
}: Deps): CollaboratorService {
  const selectByName = db.prepare<[string], Collaborator>(
    "SELECT id, name FROM collaborators WHERE name = ? COLLATE NOCASE",
  );
  const insert = db.prepare(
    "INSERT INTO collaborators (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
  );
  const updateLastSeen = db.prepare(
    "UPDATE collaborators SET last_seen_at = ? WHERE id = ? AND last_seen_at <= ?",
  );

  return {
    claim(name) {
      const time = now();
      const existing = selectByName.get(name);
      if (existing) {
        updateLastSeen.run(time, existing.id, time);
        return existing;
      }

      const collaborator: Collaborator = { id: randomUUID(), name };
      insert.run(collaborator.id, collaborator.name, time, time);
      return collaborator;
    },

    touch(id) {
      const time = now();
      updateLastSeen.run(time, id, time - LAST_SEEN_THROTTLE_MS);
    },
  };
}
