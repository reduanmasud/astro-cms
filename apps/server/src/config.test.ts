import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

const PASSWORD = "correct-horse-battery";
const SECRET = "x".repeat(32);
const required = {
  CMS_PASSWORD: PASSWORD,
  SESSION_SECRET: SECRET,
  GITHUB_TOKEN: "ghp_test",
  GITHUB_OWNER: "withastro",
  GITHUB_REPOSITORY: "blog",
};

describe("loadConfig", () => {
  it("applies defaults when only the required values are set", () => {
    expect(loadConfig(required)).toEqual({
      port: 3000,
      dataDir: "data",
      cmsPassword: PASSWORD,
      sessionSecret: SECRET,
      cookieSecure: false,
      github: {
        token: "ghp_test",
        owner: "withastro",
        repository: "blog",
        baseBranch: "main",
      },
      collaboration: null,
      storage: null,
      mcpToken: null,
      mediaGcIntervalHours: 6,
      mediaGcGraceDays: 7,
    });
  });

  it("reads explicit values", () => {
    const config = loadConfig({
      ...required,
      PORT: "8080",
      DATA_DIR: "/var/lib/astro-cms",
      COOKIE_SECURE: "true",
    });

    expect(config.port).toBe(8080);
    expect(config.dataDir).toBe("/var/lib/astro-cms");
    expect(config.cookieSecure).toBe(true);
  });

  it("defaults cookieSecure to true in production", () => {
    expect(
      loadConfig({ ...required, NODE_ENV: "production" }).cookieSecure,
    ).toBe(true);
  });

  it("lets COOKIE_SECURE=false override production", () => {
    const config = loadConfig({
      ...required,
      NODE_ENV: "production",
      COOKIE_SECURE: "false",
    });

    expect(config.cookieSecure).toBe(false);
  });

  it("requires CMS_PASSWORD", () => {
    expect(() => loadConfig({ SESSION_SECRET: SECRET })).toThrow(
      /CMS_PASSWORD is required/,
    );
  });

  it("rejects a short CMS_PASSWORD", () => {
    expect(() => loadConfig({ ...required, CMS_PASSWORD: "short" })).toThrow(
      /CMS_PASSWORD must be at least 12 characters/,
    );
  });

  it("requires SESSION_SECRET", () => {
    expect(() => loadConfig({ CMS_PASSWORD: PASSWORD })).toThrow(
      /SESSION_SECRET is required/,
    );
  });

  it("rejects a short SESSION_SECRET", () => {
    expect(() =>
      loadConfig({ ...required, SESSION_SECRET: "x".repeat(31) }),
    ).toThrow(/SESSION_SECRET must be at least 32 characters/);
  });

  it("rejects a SESSION_SECRET equal to CMS_PASSWORD", () => {
    const same = "y".repeat(32);

    expect(() =>
      loadConfig({ CMS_PASSWORD: same, SESSION_SECRET: same }),
    ).toThrow(/must be different/);
  });

  it.each(["0", "65536", "abc", "3000.5"])("rejects PORT=%s", (port) => {
    expect(() => loadConfig({ ...required, PORT: port })).toThrow(/PORT/);
  });

  it("rejects a COOKIE_SECURE value that is not true or false", () => {
    expect(() => loadConfig({ ...required, COOKIE_SECURE: "yes" })).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it("reads GITHUB_BASE_BRANCH", () => {
    const config = loadConfig({ ...required, GITHUB_BASE_BRANCH: "trunk" });

    expect(config.github.baseBranch).toBe("trunk");
  });

  it.each(["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPOSITORY"])(
    "requires %s",
    (name) => {
      expect(() => loadConfig({ ...required, [name]: "" })).toThrow(
        new RegExp(`${name} is required`),
      );
    },
  );

  it.each([
    ["GITHUB_OWNER", "not/valid"],
    ["GITHUB_REPOSITORY", "has spaces"],
    ["GITHUB_BASE_BRANCH", "../escape"],
  ])("rejects an invalid %s", (name, value) => {
    expect(() => loadConfig({ ...required, [name]: value })).toThrow(
      new RegExp(`${name} `),
    );
  });

  describe("collaboration", () => {
    const collab = {
      HOCUSPOCUS_PUBLIC_URL: "wss://collab.example/ws",
      HOCUSPOCUS_INTERNAL_URL: "ws://collab:1234",
      HOCUSPOCUS_JWT_SECRET: "j".repeat(32),
      HOCUSPOCUS_WEBHOOK_SECRET: "w".repeat(32),
    };

    it("is off when no HOCUSPOCUS_* value is set", () => {
      expect(loadConfig(required).collaboration).toBeNull();
    });

    it("reads all four values", () => {
      expect(loadConfig({ ...required, ...collab }).collaboration).toEqual({
        publicUrl: "wss://collab.example/ws",
        internalUrl: "ws://collab:1234",
        jwtSecret: "j".repeat(32),
        webhookSecret: "w".repeat(32),
      });
    });

    it("requires the other three once one is set", () => {
      expect(() =>
        loadConfig({
          ...required,
          HOCUSPOCUS_PUBLIC_URL: collab.HOCUSPOCUS_PUBLIC_URL,
        }),
      ).toThrow(/HOCUSPOCUS_INTERNAL_URL is required/);
    });

    it.each(["HOCUSPOCUS_PUBLIC_URL", "HOCUSPOCUS_INTERNAL_URL"])(
      "rejects a non-WebSocket %s",
      (name) => {
        expect(() =>
          loadConfig({
            ...required,
            ...collab,
            [name]: "https://collab.example",
          }),
        ).toThrow(new RegExp(`${name} must be a ws`));
      },
    );

    it("rejects short secrets and reusing one secret for both", () => {
      expect(() =>
        loadConfig({ ...required, ...collab, HOCUSPOCUS_JWT_SECRET: "short" }),
      ).toThrow(/HOCUSPOCUS_JWT_SECRET must be at least 32/);
      expect(() =>
        loadConfig({
          ...required,
          ...collab,
          HOCUSPOCUS_WEBHOOK_SECRET: collab.HOCUSPOCUS_JWT_SECRET,
        }),
      ).toThrow(/must be different/);
    });
  });

  it("reports every problem at once", () => {
    let problems: readonly string[] = [];
    try {
      loadConfig({ PORT: "abc", COOKIE_SECURE: "yes" });
    } catch (error) {
      if (error instanceof ConfigError) problems = error.problems;
    }

    expect(problems).toHaveLength(7);
  });

  describe("MCP_TOKEN", () => {
    it("is null when unset, so MCP stays off", () => {
      expect(loadConfig(required).mcpToken).toBeNull();
    });

    it("is kept when set", () => {
      const token = "mcp-token-that-is-long-enough-01234";

      expect(loadConfig({ ...required, MCP_TOKEN: token }).mcpToken).toBe(
        token,
      );
    });

    it("refuses a short token", () => {
      expect(() => loadConfig({ ...required, MCP_TOKEN: "too-short" })).toThrow(
        /MCP_TOKEN/,
      );
    });
  });

  describe("media collection", () => {
    it("defaults to six hours and seven days", () => {
      const config = loadConfig(required);

      expect(config.mediaGcIntervalHours).toBe(6);
      expect(config.mediaGcGraceDays).toBe(7);
    });

    it("reads explicit values", () => {
      const config = loadConfig({
        ...required,
        MEDIA_GC_INTERVAL_HOURS: "12",
        MEDIA_GC_GRACE_DAYS: "30",
      });

      expect(config.mediaGcIntervalHours).toBe(12);
      expect(config.mediaGcGraceDays).toBe(30);
    });

    it("lets zero hours switch collection off", () => {
      expect(
        loadConfig({ ...required, MEDIA_GC_INTERVAL_HOURS: "0" })
          .mediaGcIntervalHours,
      ).toBe(0);
    });

    it.each(["-1", "abc", "1.5"])("rejects MEDIA_GC_GRACE_DAYS=%s", (value) => {
      expect(() =>
        loadConfig({ ...required, MEDIA_GC_GRACE_DAYS: value }),
      ).toThrow(/MEDIA_GC_GRACE_DAYS/);
    });

    it("rejects a zero grace period", () => {
      // Zero would make a file stamped unused deletable by the same sweep.
      expect(() =>
        loadConfig({ ...required, MEDIA_GC_GRACE_DAYS: "0" }),
      ).toThrow(/MEDIA_GC_GRACE_DAYS must be a whole number of 1 or more/);
      expect(
        loadConfig({ ...required, MEDIA_GC_GRACE_DAYS: "1" }).mediaGcGraceDays,
      ).toBe(1);
    });
  });
});
