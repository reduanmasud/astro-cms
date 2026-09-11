import Database from "better-sqlite3";
import { migrations } from "./migrations.ts";

export type Db = Database.Database;

/** Opens the SQLite file (or ':memory:'), configures it, and applies pending migrations. */
export function openDatabase(filename: string): Db {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const applied = db.pragma("user_version", { simple: true }) as number;
  if (applied > migrations.length) {
    throw new Error(
      `Database schema version ${applied} is newer than this build supports (${migrations.length}).`,
    );
  }

  migrations.slice(applied).forEach((sql, index) => {
    const version = applied + index + 1;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  });
}
