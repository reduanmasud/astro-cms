import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKEN_TTL_MS,
  signCollabToken,
  verifyCollabToken,
} from "./jwt.ts";
import { createSignature, isValidSignature } from "./signature.ts";

const SECRET = "collab-jwt-secret-that-is-long-enough";
const OTHER_SECRET = "a-completely-different-collab-secret!";

const claims = { room: "doc-1", collaboratorId: "c1", name: "Ada" };

describe("collaboration tokens", () => {
  it("round-trips the room and collaborator", async () => {
    const { token, expiresAt } = await signCollabToken({
      secret: SECRET,
      ...claims,
    });

    await expect(verifyCollabToken(token, SECRET)).resolves.toEqual(claims);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects a token signed with another secret", async () => {
    const { token } = await signCollabToken({
      secret: OTHER_SECRET,
      ...claims,
    });

    await expect(verifyCollabToken(token, SECRET)).resolves.toBeUndefined();
  });

  it("rejects a token for a different room", async () => {
    const { token } = await signCollabToken({ secret: SECRET, ...claims });

    await expect(
      verifyCollabToken(token, SECRET, "doc-2"),
    ).resolves.toBeUndefined();
    await expect(verifyCollabToken(token, SECRET, "doc-1")).resolves.toEqual(
      claims,
    );
  });

  it("rejects an expired token", async () => {
    const { token } = await signCollabToken({
      secret: SECRET,
      ...claims,
      ttlMs: 1000,
      now: () => Date.now() - DEFAULT_TOKEN_TTL_MS,
    });

    await expect(verifyCollabToken(token, SECRET)).resolves.toBeUndefined();
  });

  it.each(["", "not-a-jwt", "a.b.c"])(
    "rejects malformed token %s",
    async (token) => {
      await expect(verifyCollabToken(token, SECRET)).resolves.toBeUndefined();
    },
  );
});

describe("webhook signatures", () => {
  const body = JSON.stringify({
    event: "change",
    payload: { documentName: "doc-1" },
  });

  it("accepts a signature made with the same secret", () => {
    expect(isValidSignature(SECRET, body, createSignature(SECRET, body))).toBe(
      true,
    );
  });

  it("rejects another secret, a changed body, and a missing header", () => {
    expect(
      isValidSignature(SECRET, body, createSignature(OTHER_SECRET, body)),
    ).toBe(false);
    expect(
      isValidSignature(SECRET, `${body} `, createSignature(SECRET, body)),
    ).toBe(false);
    expect(isValidSignature(SECRET, body, undefined)).toBe(false);
    expect(isValidSignature(SECRET, body, "sha256=deadbeef")).toBe(false);
  });

  it("uses the sha256= prefix HocusPocus sends", () => {
    expect(createSignature(SECRET, body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
