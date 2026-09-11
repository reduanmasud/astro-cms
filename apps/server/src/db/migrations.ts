/**
 * Ordered schema migrations. Each entry runs once; `PRAGMA user_version`
 * records how many have been applied. Never edit or reorder an existing
 * entry — append a new one instead. See docs/adr/0002-sqlite-plain-sql.md.
 */
export const migrations: readonly string[] = [
  // 1: collaborator identity and browser sessions (docs/adr/0009-minimal-authentication.md)
  `
  CREATE TABLE collaborators (
    id           TEXT    PRIMARY KEY,
    name         TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX collaborators_name ON collaborators (name COLLATE NOCASE);

  CREATE TABLE sessions (
    token_hash      TEXT    PRIMARY KEY,
    collaborator_id TEXT    REFERENCES collaborators (id) ON DELETE SET NULL,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX sessions_expires_at ON sessions (expires_at);
  `,
];
