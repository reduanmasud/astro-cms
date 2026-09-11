import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db/database.ts";
import {
  LAST_SEEN_THROTTLE_MS,
  createCollaboratorService,
} from "./collaborators.ts";
import {
  SESSION_TTL_MS,
  createSessionService,
  type SessionService,
} from "./sessions.ts";

const PASSWORD = "correct-horse-battery";

describe("session service", () => {
  let now: number;
  let db: Db;
  let sessions: SessionService;

  function build(): SessionService {
    const clock = () => now;
    return createSessionService({
      db,
      password: PASSWORD,
      collaborators: createCollaboratorService({ db, now: clock }),
      now: clock,
    });
  }

  function loginToken(): string {
    const result = sessions.login({ password: PASSWORD });
    if (!result.ok) throw new Error("login failed");
    return result.token;
  }

  beforeEach(() => {
    now = 1_000_000;
    db = openDatabase(":memory:");
    sessions = build();
  });

  describe("login", () => {
    it("creates a session without a collaborator for the correct password", () => {
      const result = sessions.login({ password: PASSWORD });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.session).toEqual({
        collaborator: null,
        expiresAt: now + SESSION_TTL_MS,
      });
    });

    it("rejects a wrong password", () => {
      expect(sessions.login({ password: "wrong-password-123" })).toEqual({
        ok: false,
        reason: "invalid_password",
      });
    });

    it("stores only a hash of the token", () => {
      const token = loginToken();

      const stored = db
        .prepare("SELECT token_hash FROM sessions")
        .pluck()
        .all();
      expect(stored).toHaveLength(1);
      expect(stored).not.toContain(token);
    });

    it("purges expired sessions", () => {
      loginToken();
      now += SESSION_TTL_MS + 1;

      loginToken();

      expect(db.prepare("SELECT COUNT(*) FROM sessions").pluck().get()).toBe(1);
    });
  });

  it("purges expired sessions when the service starts", () => {
    loginToken();
    now += SESSION_TTL_MS + 1;

    build();

    expect(db.prepare("SELECT COUNT(*) FROM sessions").pluck().get()).toBe(0);
  });

  describe("resolve", () => {
    it("returns the session for a valid token", () => {
      const token = loginToken();

      expect(sessions.resolve(token)).toEqual({
        collaborator: null,
        expiresAt: now + SESSION_TTL_MS,
      });
    });

    it("returns undefined for an unknown token", () => {
      expect(sessions.resolve("not-a-real-token")).toBeUndefined();
    });

    it("returns undefined once the session has expired", () => {
      const token = loginToken();
      now += SESSION_TTL_MS;

      expect(sessions.resolve(token)).toBeUndefined();
    });

    it("updates the collaborator's last_seen_at", () => {
      const token = loginToken();
      const chosen = sessions.chooseDisplayName(token, "Ada");
      if (!chosen.ok) throw new Error("display name rejected");
      now += LAST_SEEN_THROTTLE_MS;

      sessions.resolve(token);

      const lastSeen = db
        .prepare("SELECT last_seen_at FROM collaborators WHERE id = ?")
        .pluck()
        .get(chosen.collaborator.id);
      expect(lastSeen).toBe(now);
    });
  });

  describe("chooseDisplayName", () => {
    it("attaches a collaborator to the session", () => {
      const token = loginToken();

      const result = sessions.chooseDisplayName(token, "  Ada  ");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.collaborator.name).toBe("Ada");
      expect(sessions.resolve(token)?.collaborator).toEqual(
        result.collaborator,
      );
    });

    it("rejects an invalid name", () => {
      const token = loginToken();

      expect(sessions.chooseDisplayName(token, "")).toEqual({
        ok: false,
        reason: "invalid_display_name",
      });
    });

    it("rejects an unknown session", () => {
      expect(sessions.chooseDisplayName("not-a-real-token", "Ada")).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
    });

    it("shares one collaborator between sessions that choose the same name", () => {
      const first = sessions.chooseDisplayName(loginToken(), "Ada");
      const second = sessions.chooseDisplayName(loginToken(), "ADA");

      expect(
        first.ok &&
          second.ok &&
          first.collaborator.id === second.collaborator.id,
      ).toBe(true);
    });
  });

  describe("logout", () => {
    it("removes the session", () => {
      const token = loginToken();

      sessions.logout(token);

      expect(sessions.resolve(token)).toBeUndefined();
    });

    it("keeps the collaborator identity", () => {
      const token = loginToken();
      sessions.chooseDisplayName(token, "Ada");

      sessions.logout(token);

      expect(
        db.prepare("SELECT name FROM collaborators").pluck().all(),
      ).toEqual(["Ada"]);
    });
  });
});
