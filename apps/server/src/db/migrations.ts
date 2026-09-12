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
  // 2: drafts (docs/adr/0013-draft-storage.md). Drafting never touches GitHub;
  // the publication columns record what publishing did later.
  `
  CREATE TABLE documents (
    id                   TEXT    PRIMARY KEY,
    collection           TEXT    NOT NULL,
    path                 TEXT    NOT NULL UNIQUE,
    format               TEXT    NOT NULL CHECK (format IN ('md', 'mdx')),
    slug                 TEXT    NOT NULL,
    source               TEXT    NOT NULL,
    status               TEXT    NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'in_review', 'published')),
    revision             INTEGER NOT NULL DEFAULT 1,
    created_by           TEXT    REFERENCES collaborators (id) ON DELETE SET NULL,
    updated_by           TEXT    REFERENCES collaborators (id) ON DELETE SET NULL,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    base_commit_sha      TEXT,
    branch               TEXT,
    pull_request_number  INTEGER,
    pull_request_url     TEXT,
    published_commit_sha TEXT,
    published_at         INTEGER
  ) STRICT;

  CREATE INDEX documents_collection ON documents (collection, updated_at DESC);
  `,
  // 3: media and where it is used (docs/adr/0017-media-storage.md).
  // Objects are content-addressed, so the same bytes are stored once.
  `
  CREATE TABLE media (
    id           TEXT    PRIMARY KEY,
    object_key   TEXT    NOT NULL UNIQUE,
    filename     TEXT    NOT NULL,
    content_type TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    sha256       TEXT    NOT NULL UNIQUE,
    width        INTEGER,
    height       INTEGER,
    uploaded_by  TEXT    REFERENCES collaborators (id) ON DELETE SET NULL,
    uploaded_at  INTEGER NOT NULL,
    unused_since INTEGER
  ) STRICT;

  CREATE INDEX media_uploaded_at ON media (uploaded_at DESC);

  CREATE TABLE media_references (
    media_id    TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    PRIMARY KEY (media_id, document_id)
  ) STRICT;

  CREATE INDEX media_references_document ON media_references (document_id);
  `,
];
