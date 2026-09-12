import { createCollabServer } from "@astro-cms/collab";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { serve, type ServerType } from "@hono/node-server";
import type { Server } from "@hocuspocus/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import type { CmsDocument } from "../documents/model.ts";
import {
  buildTestApp,
  requestJson,
  signIn,
  TEST_JWT_SECRET,
  TEST_WEBHOOK_SECRET,
  type TestApp,
} from "../test-support/app.ts";

/**
 * The collaboration contract end to end: a real HocusPocus server, the real
 * CMS app, and real WebSocket clients. This is what a production HocusPocus
 * deployment has to reproduce (docs/adr/0016-collaboration-service.md).
 */

// Node's own WebSocket hands binary frames over as Blobs, which the provider
// never decodes, so `ws` takes its place for these tests.
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

const CMS_PORT = 4321;
const COLLAB_PORT = 4322;
const COLLAB_URL = `ws://127.0.0.1:${COLLAB_PORT}`;

interface Connection {
  url: string;
  room: string;
  token: string;
}

/** Waits for `check` to hold, polling briefly. */
async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the expected state");
}

function connect(
  connection: Connection,
  doc: Y.Doc,
  overrides: { name?: string; onAuthenticationFailed?: () => void } = {},
): HocuspocusProvider {
  return new HocuspocusProvider({
    url: connection.url,
    name: overrides.name ?? connection.room,
    token: connection.token,
    document: doc,
    ...(overrides.onAuthenticationFailed
      ? { onAuthenticationFailed: overrides.onAuthenticationFailed }
      : {}),
  });
}

describe("collaboration end to end", () => {
  let harness: TestApp;
  let cms: ServerType;
  let collab: Server;
  let cookie: string;
  let document: CmsDocument;

  beforeEach(async () => {
    harness = buildTestApp({ collaborationUrl: COLLAB_URL });
    cms = serve({ fetch: harness.app.fetch, port: CMS_PORT });
    collab = createCollabServer({
      jwtSecret: TEST_JWT_SECRET,
      webhookSecret: TEST_WEBHOOK_SECRET,
      webhookUrl: `http://127.0.0.1:${CMS_PORT}/api/collab/webhook`,
      debounce: 50,
      debounceMaxWait: 200,
    });
    await collab.listen(COLLAB_PORT);

    cookie = await signIn(harness.app, "Ada");
    const created = (await (
      await requestJson(harness.app, cookie, "POST", "/api/documents", {
        collection: "blog",
        path: "src/content/blog/hello.md",
      })
    ).json()) as { document: CmsDocument };
    document = created.document;
  });

  afterEach(async () => {
    await collab.destroy();
    cms.close();
  });

  async function tokenFor(id = document.id): Promise<Connection> {
    const response = await requestJson(
      harness.app,
      cookie,
      "GET",
      `/api/documents/${id}/collaboration`,
    );
    return (await response.json()) as Connection;
  }

  function draft(): CmsDocument {
    return harness.documents.get(document.id);
  }

  it("authenticates with the CMS token and shares edits between two clients", async () => {
    const connection = await tokenFor();
    const first = new Y.Doc();
    const second = new Y.Doc();
    const a = connect(connection, first);
    const b = connect(connection, second);

    await until(() => a.isSynced && b.isSynced);

    // The same field the editor uses, so this is a real editing round trip.
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("hello from A")]);
    first.getXmlFragment("default").insert(0, [paragraph]);

    // toJSON keeps this a plain value; a fragment has no useful toString.
    const textOf = (doc: Y.Doc): string =>
      JSON.stringify(doc.getXmlFragment("default").toJSON());

    await until(() => textOf(second).includes("hello from A"));
    expect(textOf(second)).toContain("hello from A");
    a.destroy();
    b.destroy();
  });

  it("refuses a token issued for another room", async () => {
    const other = (await (
      await requestJson(harness.app, cookie, "POST", "/api/documents", {
        collection: "blog",
        path: "src/content/blog/other.md",
      })
    ).json()) as { document: CmsDocument };
    const connection = await tokenFor(other.document.id);

    let failed = false;
    // The token is for the other document, so this room must be refused.
    const provider = connect(connection, new Y.Doc(), {
      name: document.id,
      onAuthenticationFailed: () => {
        failed = true;
      },
    });

    await until(() => failed);
    expect(failed).toBe(true);
    provider.destroy();
  });

  it("saves the room's content to SQLite through the webhook", async () => {
    const connection = await tokenFor();
    const doc = new Y.Doc();
    const provider = connect(connection, doc);
    await until(() => provider.isSynced);

    // What Tiptap's Collaboration extension writes for "# Live".
    const fragment = doc.getXmlFragment("default");
    const heading = new Y.XmlElement("heading");
    heading.setAttribute("level", "1");
    heading.insert(0, [new Y.XmlText("Live")]);
    fragment.insert(0, [heading]);

    await until(() => draft().source.includes("# Live"), 8000);

    expect(draft().source).toContain("# Live");
    expect(draft().updatedBy?.name).toBe("Ada");
    expect(harness.github.branchNames()).toEqual(["main"]);
    provider.destroy();
  });

  it("recovers the draft after the collaboration server restarts", async () => {
    const connection = await tokenFor();
    const doc = new Y.Doc();
    const provider = connect(connection, doc);
    await until(() => provider.isSynced);

    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Before the restart")]);
    fragment.insert(0, [paragraph]);
    await until(() => draft().source.includes("Before the restart"), 8000);

    provider.destroy();
    await collab.destroy();
    collab = createCollabServer({
      jwtSecret: TEST_JWT_SECRET,
      webhookSecret: TEST_WEBHOOK_SECRET,
      webhookUrl: `http://127.0.0.1:${CMS_PORT}/api/collab/webhook`,
      debounce: 50,
      debounceMaxWait: 200,
    });
    await collab.listen(COLLAB_PORT);

    // The draft survived in SQLite, which is what a reconnecting client reads.
    expect(draft().source).toContain("Before the restart");

    const reconnected = connect(await tokenFor(), new Y.Doc());
    await until(() => reconnected.isSynced, 8000);
    expect(reconnected.isSynced).toBe(true);
    reconnected.destroy();
  });
});
