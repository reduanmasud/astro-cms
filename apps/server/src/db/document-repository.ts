import type {
  CmsDocument,
  DocumentFormat,
  DocumentStatus,
  DocumentSummary,
} from "../documents/model.ts";
import type { Db } from "./database.ts";

/** Everything needed to insert a new draft. Status starts as "draft", revision as 1. */
export interface NewDocumentRecord {
  readonly id: string;
  readonly collection: string;
  readonly path: string;
  readonly format: DocumentFormat;
  readonly slug: string;
  readonly source: string;
  readonly createdBy: string | null;
  readonly createdAt: number;
  readonly baseCommitSha: string | null;
}

export interface DocumentChanges {
  readonly source?: string;
  readonly slug?: string;
  readonly status?: DocumentStatus;
  readonly updatedBy: string | null;
  readonly updatedAt: number;
}

export interface DocumentQuery {
  readonly collection?: string;
  readonly status?: DocumentStatus;
  /** Case-insensitive substring of path, slug, or source. */
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
}

/** What one publish records. Written together, so they are one shape. */
export interface PublicationChanges {
  readonly branch: string;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly publishedCommitSha: string;
  readonly publishedAt: number;
  readonly status: DocumentStatus;
}

/** SQL access for documents. No business rules live here. */
export interface DocumentRepository {
  insert(record: NewDocumentRecord): void;
  findById(id: string): CmsDocument | undefined;
  findByPath(path: string): CmsDocument | undefined;
  list(query: DocumentQuery): DocumentSummary[];
  /** Returns false when no row matched: unknown id, or `expectedRevision` is stale. */
  update(
    id: string,
    changes: DocumentChanges,
    expectedRevision?: number,
  ): boolean;
  delete(id: string): boolean;
  /** Records one publish. Does not bump `revision`: the draft did not change. */
  setPublication(id: string, changes: PublicationChanges): void;
  /** Moves the drift baseline (docs/adr/0005-drift-detection.md). */
  setBaseCommit(id: string, sha: string): void;
  setStatus(id: string, status: DocumentStatus): void;
}

interface DocumentRow {
  id: string;
  collection: string;
  path: string;
  format: DocumentFormat;
  slug: string;
  source?: string;
  status: DocumentStatus;
  revision: number;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: number;
  updated_at: number;
  base_commit_sha: string | null;
  branch: string | null;
  pull_request_number: number | null;
  pull_request_url: string | null;
  published_commit_sha: string | null;
  published_at: number | null;
}

const SUMMARY_COLUMNS = `
  d.id, d.collection, d.path, d.format, d.slug, d.status, d.revision,
  d.created_by, creator.name AS created_by_name,
  d.updated_by, updater.name AS updated_by_name,
  d.created_at, d.updated_at,
  d.base_commit_sha, d.branch, d.pull_request_number, d.pull_request_url,
  d.published_commit_sha, d.published_at`;

const FROM = `
  FROM documents d
  LEFT JOIN collaborators creator ON creator.id = d.created_by
  LEFT JOIN collaborators updater ON updater.id = d.updated_by`;

export function createDocumentRepository(db: Db): DocumentRepository {
  const insert = db.prepare(`
    INSERT INTO documents
      (id, collection, path, format, slug, source, created_by, updated_by,
       created_at, updated_at, base_commit_sha)
    VALUES
      (@id, @collection, @path, @format, @slug, @source, @createdBy, @createdBy,
       @createdAt, @createdAt, @baseCommitSha)
  `);
  const selectById = db.prepare<[string], DocumentRow>(
    `SELECT ${SUMMARY_COLUMNS}, d.source ${FROM} WHERE d.id = ?`,
  );
  const selectByPath = db.prepare<[string], DocumentRow>(
    `SELECT ${SUMMARY_COLUMNS}, d.source ${FROM} WHERE d.path = ?`,
  );
  const deleteById = db.prepare("DELETE FROM documents WHERE id = ?");

  return {
    insert(record) {
      insert.run(record);
    },

    findById(id) {
      const row = selectById.get(id);
      return row && toDocument(row);
    },

    findByPath(path) {
      const row = selectByPath.get(path);
      return row && toDocument(row);
    },

    list({ collection, status, search, limit, offset }) {
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (collection !== undefined) {
        conditions.push("d.collection = ?");
        params.push(collection);
      }
      if (status !== undefined) {
        conditions.push("d.status = ?");
        params.push(status);
      }
      if (search !== undefined && search !== "") {
        // LIKE is case-insensitive for ASCII in SQLite; % and _ are escaped.
        conditions.push(
          "(d.path LIKE ? ESCAPE '\\' OR d.slug LIKE ? ESCAPE '\\' OR d.source LIKE ? ESCAPE '\\')",
        );
        const pattern = `%${escapeLike(search)}%`;
        params.push(pattern, pattern, pattern);
      }
      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = db
        .prepare<(string | number)[], DocumentRow>(
          `SELECT ${SUMMARY_COLUMNS} ${FROM} ${where}
           ORDER BY d.updated_at DESC, d.created_at DESC, d.rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      return rows.map(toSummary);
    },

    update(id, changes, expectedRevision) {
      const assignments: string[] = [];
      const params: (string | number | null)[] = [];
      for (const [column, value] of [
        ["source", changes.source],
        ["slug", changes.slug],
        ["status", changes.status],
      ] as const) {
        if (value !== undefined) {
          assignments.push(`${column} = ?`);
          params.push(value);
        }
      }
      assignments.push(
        "updated_by = ?",
        "updated_at = ?",
        "revision = revision + 1",
      );
      params.push(changes.updatedBy, changes.updatedAt, id);

      const revisionCheck =
        expectedRevision === undefined ? "" : " AND revision = ?";
      if (expectedRevision !== undefined) params.push(expectedRevision);

      const result = db
        .prepare(
          `UPDATE documents SET ${assignments.join(", ")} WHERE id = ?${revisionCheck}`,
        )
        .run(...params);
      return result.changes > 0;
    },

    delete(id) {
      return deleteById.run(id).changes > 0;
    },

    setPublication(id, changes) {
      db.prepare(
        `UPDATE documents
            SET branch = ?, pull_request_number = ?, pull_request_url = ?,
                published_commit_sha = ?, published_at = ?, status = ?
          WHERE id = ?`,
      ).run(
        changes.branch,
        changes.pullRequestNumber,
        changes.pullRequestUrl,
        changes.publishedCommitSha,
        changes.publishedAt,
        changes.status,
        id,
      );
    },

    setBaseCommit(id, sha) {
      db.prepare("UPDATE documents SET base_commit_sha = ? WHERE id = ?").run(
        sha,
        id,
      );
    },

    setStatus(id, status) {
      db.prepare("UPDATE documents SET status = ? WHERE id = ?").run(
        status,
        id,
      );
    },
  };
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    collection: row.collection,
    path: row.path,
    format: row.format,
    slug: row.slug,
    status: row.status,
    revision: row.revision,
    createdBy: collaborator(row.created_by, row.created_by_name),
    updatedBy: collaborator(row.updated_by, row.updated_by_name),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publication: {
      baseCommitSha: row.base_commit_sha,
      branch: row.branch,
      pullRequestNumber: row.pull_request_number,
      pullRequestUrl: row.pull_request_url,
      publishedCommitSha: row.published_commit_sha,
      publishedAt: row.published_at,
    },
  };
}

function toDocument(row: DocumentRow): CmsDocument {
  return { ...toSummary(row), source: row.source ?? "" };
}

function collaborator(
  id: string | null,
  name: string | null,
): DocumentSummary["createdBy"] {
  return id !== null && name !== null ? { id, name } : null;
}
