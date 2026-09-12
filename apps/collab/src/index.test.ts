import { Webhook } from "@hocuspocus/extension-webhook";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createCollabServer } from "./index.ts";

/**
 * The contract a production HocusPocus server has to reproduce
 * (docs/adr/0016-collaboration-service.md).
 */

const JWT_SECRET = "collab-jwt-secret-that-is-long-enough";
const WEBHOOK_SECRET = "collab-webhook-secret-long-enough!!";
const WEBHOOK_URL = "http://cms:3000/api/collab/webhook";

function server() {
  return createCollabServer({
    jwtSecret: JWT_SECRET,
    webhookSecret: WEBHOOK_SECRET,
    webhookUrl: WEBHOOK_URL,
  });
}

function webhookExtension(): Webhook {
  const found = server().configuration.extensions?.find(
    (extension) => extension instanceof Webhook,
  );
  if (!(found instanceof Webhook))
    throw new Error("No webhook extension configured");
  return found;
}

async function token(options: {
  room: string;
  secret?: string;
  name?: unknown;
}): Promise<string> {
  return new SignJWT({ name: options.name ?? "Ada" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("c1")
    .setAudience(options.room)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(options.secret ?? JWT_SECRET));
}

/** `onAuthenticate` only reads the token and the document name. */
function authenticate(documentName: string, value: string): Promise<unknown> {
  // Called on the configuration object so the hook keeps its `this`.
  const configuration = server().configuration;
  const result = configuration.onAuthenticate?.({
    token: value,
    documentName,
  } as never);
  if (result === undefined) throw new Error("No onAuthenticate configured");
  return result;
}

describe("webhook configuration", () => {
  it("sends only create and change", () => {
    // `connect` is left out on purpose: a failed connect webhook makes
    // HocusPocus refuse the connection, so a CMS outage would stop editing.
    expect(webhookExtension().configuration.events).toEqual([
      "create",
      "change",
    ]);
  });

  it("points at the CMS and signs with the shared secret", () => {
    expect(webhookExtension().configuration).toMatchObject({
      url: WEBHOOK_URL,
      secret: WEBHOOK_SECRET,
    });
  });

  it("debounces saves", () => {
    const { debounce, debounceMaxWait } = webhookExtension().configuration;

    expect(debounce).toBeGreaterThan(0);
    expect(debounceMaxWait).toBeGreaterThanOrEqual(Number(debounce));
  });
});

describe("authentication", () => {
  it("accepts a token whose room matches the document", async () => {
    await expect(
      authenticate("room-1", await token({ room: "room-1" })),
    ).resolves.toEqual({
      collaboratorId: "c1",
      name: "Ada",
    });
  });

  it("refuses a token issued for another room", async () => {
    await expect(
      authenticate("room-1", await token({ room: "room-2" })),
    ).rejects.toThrow();
  });

  it("refuses a token signed with another secret", async () => {
    const other = await token({
      room: "room-1",
      secret: "a-different-secret-that-is-long-too",
    });

    await expect(authenticate("room-1", other)).rejects.toThrow();
  });

  it("refuses a token with no collaborator name", async () => {
    const nameless = await token({ room: "room-1", name: 42 });

    await expect(authenticate("room-1", nameless)).rejects.toThrow(
      /collaborator/,
    );
  });

  it("refuses a malformed token", async () => {
    await expect(authenticate("room-1", "not-a-jwt")).rejects.toThrow();
  });
});
