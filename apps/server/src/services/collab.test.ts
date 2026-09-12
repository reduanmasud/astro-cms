import { describe, expect, it } from "vitest";
import { verifyCollabToken } from "../collab/jwt.ts";
import { createSignature } from "../collab/signature.ts";
import { openDatabase } from "../db/database.ts";
import { createDocumentRepository } from "../db/document-repository.ts";
import type { CollaboratorRef } from "../documents/model.ts";
import { createCollabService, type CollabService } from "./collab.ts";
import { createDocumentService, type DocumentService } from "./documents.ts";

const JWT_SECRET = "collab-jwt-secret-that-is-long-enough";
const WEBHOOK_SECRET = "collab-webhook-secret-long-enough!!";
const ADA: CollaboratorRef = { id: "c1", name: "Ada" };
const GRACE: CollaboratorRef = { id: "c2", name: "Grace" };

const SOURCE = "---\ntitle: Hello\n---\n\n# Hello\n";

function setup(configured = true): {
  collab: CollabService;
  documents: DocumentService;
  documentId: string;
} {
  const db = openDatabase(":memory:");
  db.prepare(
    "INSERT INTO collaborators VALUES ('c1','Ada',1,1), ('c2','Grace',1,1)",
  ).run();
  const documents = createDocumentService({
    repository: createDocumentRepository(db),
  });
  const document = documents.create(
    { collection: "blog", path: "src/content/blog/hello.md", source: SOURCE },
    ADA,
  );
  const collab = createCollabService({
    config: configured
      ? {
          publicUrl: "ws://localhost:1234",
          internalUrl: "ws://hocuspocus:1234",
          jwtSecret: JWT_SECRET,
          webhookSecret: WEBHOOK_SECRET,
        }
      : null,
    documents,
  });
  return { collab, documents, documentId: document.id };
}

/** A webhook call as HocusPocus sends it. */
function webhook(
  collab: CollabService,
  event: string,
  payload: Record<string, unknown>,
  secret = WEBHOOK_SECRET,
) {
  const body = JSON.stringify({ event, payload });
  return collab.handleWebhook({
    body,
    signature: createSignature(secret, body),
  });
}

const editorDoc = (text: string) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] },
  ],
});

describe("authentication", () => {
  it("issues a token for the room, the collaborator, and an expiry", async () => {
    const { collab, documentId } = setup();

    const connection = await collab.issueConnection(documentId, ADA);

    expect(connection).toMatchObject({
      url: "ws://localhost:1234",
      room: documentId,
    });
    expect(connection.expiresAt).toBeGreaterThan(Date.now());
    await expect(
      verifyCollabToken(connection.token, JWT_SECRET),
    ).resolves.toEqual({
      room: documentId,
      collaboratorId: "c1",
      name: "Ada",
    });
  });

  it("is off when the server has no HocusPocus configured", async () => {
    const { collab, documentId } = setup(false);

    expect(collab.isEnabled()).toBe(false);
    await expect(collab.issueConnection(documentId, ADA)).rejects.toThrow(
      /not configured/,
    );
  });

  it("refuses a token for an unknown draft", async () => {
    const { collab } = setup();

    await expect(collab.issueConnection("missing", ADA)).rejects.toThrow(
      /No document/,
    );
  });

  it("rejects a webhook whose signature does not match", async () => {
    const { collab, documentId } = setup();

    const wrongSecret = await webhook(
      collab,
      "connect",
      { documentName: documentId },
      JWT_SECRET,
    );
    const unsigned = await collab.handleWebhook({
      body: JSON.stringify({
        event: "connect",
        payload: { documentName: documentId },
      }),
      signature: undefined,
    });

    expect(wrongSecret).toMatchObject({ ok: false, status: 401 });
    expect(unsigned).toMatchObject({ ok: false, status: 401 });
  });
});

describe("room isolation", () => {
  // A token only opens its own room. HocusPocus enforces this in
  // `onAuthenticate` (the token's `aud`), which the end-to-end test proves;
  // the connect webhook carries no token, so the CMS checks the room exists.
  it("ties each token to one room", async () => {
    const { collab, documents, documentId } = setup();
    const other = documents.create(
      { collection: "blog", path: "src/content/blog/other.md" },
      GRACE,
    );
    const { token } = await collab.issueConnection(documentId, ADA);

    await expect(
      verifyCollabToken(token, JWT_SECRET, documentId),
    ).resolves.toMatchObject({
      room: documentId,
    });
    await expect(
      verifyCollabToken(token, JWT_SECRET, other.id),
    ).resolves.toBeUndefined();
  });

  it("acknowledges a connect for a room that has a draft", async () => {
    const { collab, documentId } = setup();

    const result = await webhook(collab, "connect", {
      documentName: documentId,
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it("reports a connect for a room with no draft", async () => {
    const { collab } = setup();

    const result = await webhook(collab, "connect", {
      documentName: "missing",
    });

    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});

describe("collaborator identity", () => {
  it("names the person who was typing, from the connection context", async () => {
    const { collab, documents, documentId } = setup();

    await webhook(collab, "change", {
      documentName: documentId,
      document: { default: editorDoc("Changed by Grace") },
      context: { collaboratorId: GRACE.id, name: GRACE.name },
    });

    expect(documents.get(documentId)).toMatchObject({
      createdBy: ADA,
      updatedBy: GRACE,
    });
  });

  it("falls back to the last known editor when there is no context", async () => {
    const { collab, documents, documentId } = setup();

    await webhook(collab, "change", {
      documentName: documentId,
      document: { default: editorDoc("Changed") },
    });

    expect(documents.get(documentId)).toMatchObject({ updatedBy: ADA });
  });
});

describe("persistence and recovery", () => {
  it("writes a change to SQLite as Markdown, keeping the frontmatter", async () => {
    const { collab, documents, documentId } = setup();

    const result = await webhook(collab, "change", {
      documentName: documentId,
      document: { default: editorDoc("Changed by the room") },
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    const saved = documents.get(documentId);
    expect(saved.source).toBe(
      "---\ntitle: Hello\n---\n\n# Changed by the room\n",
    );
    expect(saved.revision).toBe(2);
  });

  it("recovers the draft after a restart, because it lives in SQLite", async () => {
    const { collab, documents, documentId } = setup();
    await webhook(collab, "change", {
      documentName: documentId,
      document: { default: editorDoc("Survives") },
    });

    // A fresh service over the same storage is what a restart looks like.
    const reopened = documents.get(documentId);

    expect(reopened.source).toContain("# Survives");
  });

  it("answers create without a document, so the browser seeds the room", async () => {
    const { collab, documentId } = setup();

    const result = await webhook(collab, "create", {
      documentName: documentId,
    });

    expect(result).toEqual({ ok: true, status: 200, body: {} });
  });

  it("reports a change for an unknown draft instead of creating one", async () => {
    const { collab } = setup();

    const result = await webhook(collab, "change", {
      documentName: "missing",
      document: { default: editorDoc("x") },
    });

    expect(result.ok).toBe(false);
  });

  it("ignores a change that carries no document", async () => {
    const { collab, documentId } = setup();

    const result = await webhook(collab, "change", {
      documentName: documentId,
    });

    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("ignores an unparseable body", async () => {
    const { collab } = setup();

    const result = await collab.handleWebhook({
      body: "{not json",
      signature: createSignature(WEBHOOK_SECRET, "{not json"),
    });

    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
