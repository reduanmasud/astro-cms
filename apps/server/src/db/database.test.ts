import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations } from "./migrations.ts";
import { migrate, openDatabase } from "./database.ts";

describe("openDatabase", () => {
  it("applies every migration", () => {
    const db = openDatabase(":memory:");

    expect(db.pragma("user_version", { simple: true })).toBe(migrations.length);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .pluck()
      .all();
    expect(tables).toEqual(["collaborators", "documents", "sessions"]);
  });

  it("enables foreign keys", () => {
    const db = openDatabase(":memory:");

    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("migrate", () => {
  it("is a no-op when the schema is current", () => {
    const db = openDatabase(":memory:");

    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(migrations.length);
  });

  it("upgrades an older database step by step and keeps its data", () => {
    const db = new Database(":memory:");
    db.exec(migrations[0] ?? "");
    db.pragma("user_version = 1");
    db.prepare("INSERT INTO collaborators VALUES ('c1', 'Ada', 1, 1)").run();

    migrate(db);

    expect(db.pragma("user_version", { simple: true })).toBe(migrations.length);
    expect(db.prepare("SELECT name FROM collaborators").pluck().all()).toEqual([
      "Ada",
    ]);
    expect(db.prepare("SELECT COUNT(*) FROM documents").pluck().get()).toBe(0);
  });

  it("refuses a database created by a newer build", () => {
    const db = openDatabase(":memory:");
    db.pragma(`user_version = ${migrations.length + 1}`);

    expect(() => migrate(db)).toThrow(/newer than this build supports/);
  });
});
