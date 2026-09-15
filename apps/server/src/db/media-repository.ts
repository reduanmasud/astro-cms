import type { Db } from "./database.ts";

/**
 * SQL for media metadata and where each file is used. No business rules here
 * (docs/adr/0013-draft-storage.md applies the same split to media).
 */

export interface MediaRecord {
  readonly id: string;
  /** Key in the bucket. */
  readonly objectKey: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly uploadedBy: { readonly id: string; readonly name: string } | null;
  readonly uploadedAt: number;
  /** When the file was first seen with no references, or null while in use. */
  readonly unusedSince: number | null;
  /** Drafts that currently use it. */
  readonly referenceCount: number;
}

export interface NewMediaRecord {
  readonly id: string;
  readonly objectKey: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly uploadedBy: string | null;
  readonly uploadedAt: number;
}

export interface MediaQuery {
  /** Only files with no references. */
  readonly unusedOnly?: boolean;
  readonly limit: number;
  readonly offset: number;
}

/** One place in the repository where a media file is mentioned. */
export interface GitReference {
  readonly mediaId: string;
  readonly path: string;
}

export interface MediaRepository {
  insert(record: NewMediaRecord): void;
  findById(id: string): MediaRecord | undefined;
  findBySha256(sha256: string): MediaRecord | undefined;
  findByObjectKeys(keys: readonly string[]): MediaRecord[];
  list(query: MediaQuery): MediaRecord[];
  delete(id: string): boolean;
  /** Replaces the references of one document. */
  setReferences(documentId: string, mediaIds: readonly string[]): void;
  /** Stamps or clears `unused_since` so unused files can age out. */
  refreshUnusedMarkers(now: number): void;
  /** Replaces every reference recorded for one git ref. */
  setGitReferences(ref: string, references: readonly GitReference[]): void;
  /** Forgets a ref entirely, e.g. a branch that was merged and deleted. */
  deleteGitReferences(ref: string): void;
  /** Refs that currently have references recorded. */
  listGitRefs(): string[];
  /** Unused at or before `before`, and still unreferenced now. */
  findDeletable(before: number): MediaRecord[];
}

interface MediaRow {
  id: string;
  object_key: string;
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: number;
  unused_since: number | null;
  reference_count: number;
}

/** A file is referenced when any draft or any git ref mentions it. */
const REFERENCED = (alias: string): string => `(
    EXISTS (SELECT 1 FROM media_references r WHERE r.media_id = ${alias})
    OR EXISTS (SELECT 1 FROM media_git_references g WHERE g.media_id = ${alias})
  )`;

const COLUMNS = `
  m.id, m.object_key, m.filename, m.content_type, m.size, m.sha256,
  m.width, m.height, m.uploaded_by, c.name AS uploaded_by_name,
  m.uploaded_at, m.unused_since,
  (SELECT COUNT(*) FROM media_references r WHERE r.media_id = m.id)
  + (SELECT COUNT(*) FROM media_git_references g WHERE g.media_id = m.id)
    AS reference_count`;

const FROM = `
  FROM media m
  LEFT JOIN collaborators c ON c.id = m.uploaded_by`;

export function createMediaRepository(db: Db): MediaRepository {
  const insert = db.prepare(`
    INSERT INTO media
      (id, object_key, filename, content_type, size, sha256, width, height,
       uploaded_by, uploaded_at)
    VALUES
      (@id, @objectKey, @filename, @contentType, @size, @sha256, @width, @height,
       @uploadedBy, @uploadedAt)
  `);
  const selectById = db.prepare<[string], MediaRow>(
    `SELECT ${COLUMNS} ${FROM} WHERE m.id = ?`,
  );
  const selectBySha = db.prepare<[string], MediaRow>(
    `SELECT ${COLUMNS} ${FROM} WHERE m.sha256 = ?`,
  );
  const deleteById = db.prepare("DELETE FROM media WHERE id = ?");
  const deleteReferences = db.prepare(
    "DELETE FROM media_references WHERE document_id = ?",
  );
  const insertReference = db.prepare(
    "INSERT OR IGNORE INTO media_references (media_id, document_id) VALUES (?, ?)",
  );
  const deleteGitRef = db.prepare(
    "DELETE FROM media_git_references WHERE ref = ?",
  );
  const insertGitRef = db.prepare(
    "INSERT OR IGNORE INTO media_git_references (media_id, ref, path) VALUES (?, ?, ?)",
  );
  const selectGitRefs = db
    .prepare<[], string>("SELECT DISTINCT ref FROM media_git_references")
    .pluck();
  const selectDeletable = db.prepare<[number], MediaRow>(`
    SELECT ${COLUMNS} ${FROM}
    WHERE m.unused_since IS NOT NULL AND m.unused_since <= ?
      AND NOT ${REFERENCED("m.id")}
    ORDER BY m.unused_since ASC
  `);
  // A file in use again loses its mark; one that fell out of use gets stamped.
  const clearMarkers = db.prepare(`
    UPDATE media SET unused_since = NULL
    WHERE unused_since IS NOT NULL AND ${REFERENCED("media.id")}
  `);
  const stampMarkers = db.prepare(`
    UPDATE media SET unused_since = ?
    WHERE unused_since IS NULL AND NOT ${REFERENCED("media.id")}
  `);

  return {
    insert(record) {
      insert.run(record);
    },

    findById(id) {
      const row = selectById.get(id);
      return row && toRecord(row);
    },

    findBySha256(sha256) {
      const row = selectBySha.get(sha256);
      return row && toRecord(row);
    },

    findByObjectKeys(keys) {
      if (keys.length === 0) return [];
      const placeholders = keys.map(() => "?").join(", ");
      return db
        .prepare<string[], MediaRow>(
          `SELECT ${COLUMNS} ${FROM} WHERE m.object_key IN (${placeholders})`,
        )
        .all(...keys)
        .map(toRecord);
    },

    list({ unusedOnly, limit, offset }) {
      const where = unusedOnly ? `WHERE NOT ${REFERENCED("m.id")}` : "";
      return db
        .prepare<[number, number], MediaRow>(
          `SELECT ${COLUMNS} ${FROM} ${where} ORDER BY m.uploaded_at DESC, m.rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(limit, offset)
        .map(toRecord);
    },

    delete(id) {
      return deleteById.run(id).changes > 0;
    },

    setReferences(documentId, mediaIds) {
      db.transaction(() => {
        deleteReferences.run(documentId);
        for (const mediaId of mediaIds)
          insertReference.run(mediaId, documentId);
      })();
    },

    refreshUnusedMarkers(now) {
      db.transaction(() => {
        clearMarkers.run();
        stampMarkers.run(now);
      })();
    },

    setGitReferences(ref, references) {
      db.transaction(() => {
        deleteGitRef.run(ref);
        for (const reference of references)
          insertGitRef.run(reference.mediaId, ref, reference.path);
      })();
    },

    deleteGitReferences(ref) {
      deleteGitRef.run(ref);
    },

    listGitRefs() {
      return selectGitRefs.all();
    },

    findDeletable(before) {
      return selectDeletable.all(before).map(toRecord);
    },
  };
}

function toRecord(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    objectKey: row.object_key,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    uploadedBy:
      row.uploaded_by !== null && row.uploaded_by_name !== null
        ? { id: row.uploaded_by, name: row.uploaded_by_name }
        : null,
    uploadedAt: row.uploaded_at,
    unusedSince: row.unused_since,
    referenceCount: row.reference_count,
  };
}
