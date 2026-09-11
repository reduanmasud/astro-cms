import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

const PASSWORD = "correct-horse-battery";
const SECRET = "x".repeat(32);
const required = { CMS_PASSWORD: PASSWORD, SESSION_SECRET: SECRET };

describe("loadConfig", () => {
  it("applies defaults when only the required values are set", () => {
    expect(loadConfig(required)).toEqual({
      port: 3000,
      dataDir: "data",
      cmsPassword: PASSWORD,
      sessionSecret: SECRET,
      cookieSecure: false,
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

  it("reports every problem at once", () => {
    let problems: readonly string[] = [];
    try {
      loadConfig({ PORT: "abc", COOKIE_SECURE: "yes" });
    } catch (error) {
      if (error instanceof ConfigError) problems = error.problems;
    }

    expect(problems).toHaveLength(4);
  });
});
