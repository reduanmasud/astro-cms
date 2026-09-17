import { deflateSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { createMediaRepository } from "../db/media-repository.ts";
import {
  buildTestApp,
  requestJson,
  signIn,
  type TestApp,
} from "../test-support/app.ts";

/** A real PNG, so the server's own inspection accepts it. */
function png(width = 2, height = 2): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.byteLength);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(height * (width * 4 + 1)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface MediaBody {
  media?: {
    id: string;
    url: string;
    size: number;
    width: number;
    referenceCount: number;
  } & Record<string, unknown>;
  created?: boolean;
  storage?: { size: number } | null;
  exists?: boolean;
  error?: { code: string; message: string };
}

interface ListBody {
  media: { id: string; filename: string; referenceCount: number }[];
}

describe("media API", () => {
  let harness: TestApp;
  let cookie: string;

  beforeEach(async () => {
    harness = buildTestApp();
    cookie = await signIn(harness.app, "Ada");
  });

  /** Uploads through the real multipart path. */
  function upload(
    bytes: Buffer,
    filename = "hero.png",
    sessionCookie = cookie,
  ): Promise<Response> {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], filename));
    return Promise.resolve(
      harness.app.request("/api/media", {
        method: "POST",
        headers: { Cookie: sessionCookie, "Sec-Fetch-Site": "same-origin" },
        body: form,
      }),
    );
  }

  async function read(response: Response): Promise<MediaBody> {
    return (await response.json()) as MediaBody;
  }

  describe("POST /api/media", () => {
    it("stores an image and returns its public URL and metadata", async () => {
      const response = await upload(png(4, 3));
      const body = await read(response);

      expect(response.status).toBe(201);
      expect(body.created).toBe(true);
      expect(body.media).toMatchObject({
        filename: "hero.png",
        contentType: "image/png",
        width: 4,
        height: 3,
        uploadedBy: { name: "Ada" },
      });
      expect(body.media?.url).toMatch(
        /^https:\/\/media\.test\/media\/[0-9a-f]{2}\//,
      );
      expect(harness.mediaStorage.keys()).toHaveLength(1);
    });

    it("never returns storage credentials", async () => {
      const text = await (await upload(png())).text();

      expect(text).not.toMatch(/secret|accessKey|S3_|password/i);
    });

    it("returns the same record for identical bytes", async () => {
      const first = await read(await upload(png(), "a.png"));
      const response = await upload(png(), "same-again.png");

      expect(response.status).toBe(200);
      expect((await read(response)).media?.id).toBe(first.media?.id);
      expect(harness.mediaStorage.keys()).toHaveLength(1);
    });

    it("rejects a file that is not an accepted image", async () => {
      const response = await upload(Buffer.from("#!/bin/sh\n"), "script.png");

      expect(response.status).toBe(415);
      expect((await read(response)).error?.code).toBe("unsupported_type");
    });

    it("rejects a request with no file field", async () => {
      const response = await harness.app.request("/api/media", {
        method: "POST",
        headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
        body: new FormData(),
      });

      expect(response.status).toBe(400);
    });

    it("requires a display name", async () => {
      const app = buildTestApp();
      const nameless = await signIn(app.app);
      const form = new FormData();
      form.append("file", new File([new Uint8Array(png())], "a.png"));

      const response = await app.app.request("/api/media", {
        method: "POST",
        headers: { Cookie: nameless, "Sec-Fetch-Site": "same-origin" },
        body: form,
      });

      expect(response.status).toBe(403);
    });

    it("requires a session", async () => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(png())], "a.png"));

      const response = await harness.app.request("/api/media", {
        method: "POST",
        headers: { "Sec-Fetch-Site": "same-origin" },
        body: form,
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/media", () => {
    it("lists uploads and filters to unused ones", async () => {
      const uploaded = await read(await upload(png(2, 2), "used.png"));
      await upload(png(6, 6), "spare.png");
      await requestJson(harness.app, cookie, "POST", "/api/documents", {
        collection: "blog",
        path: "src/content/blog/hello.md",
      });
      const drafts = (await (
        await requestJson(harness.app, cookie, "GET", "/api/documents")
      ).json()) as { documents: { id: string }[] };
      await requestJson(
        harness.app,
        cookie,
        "PATCH",
        `/api/documents/${drafts.documents[0]?.id ?? ""}`,
        { source: `# Hi\n\n![used](${uploaded.media?.url ?? ""})\n` },
      );

      const all = (await (
        await requestJson(harness.app, cookie, "GET", "/api/media")
      ).json()) as ListBody;
      const unused = (await (
        await requestJson(harness.app, cookie, "GET", "/api/media?unused=true")
      ).json()) as ListBody;

      expect(all.media).toHaveLength(2);
      expect(
        all.media.find((m) => m.filename === "used.png")?.referenceCount,
      ).toBe(1);
      expect(unused.media.map((m) => m.filename)).toEqual(["spare.png"]);
    });

    it("rejects bad paging", async () => {
      const response = await requestJson(
        harness.app,
        cookie,
        "GET",
        "/api/media?limit=0",
      );

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/media/:id", () => {
    it("returns metadata, and checks storage when asked", async () => {
      const uploaded = await read(await upload(png()));
      const id = uploaded.media?.id ?? "";

      const plain = await read(
        await requestJson(harness.app, cookie, "GET", `/api/media/${id}`),
      );
      const verified = await read(
        await requestJson(
          harness.app,
          cookie,
          "GET",
          `/api/media/${id}?verify=true`,
        ),
      );

      expect(plain.media?.id).toBe(id);
      expect(verified.exists).toBe(true);
      expect(verified.storage?.size).toBe(uploaded.media?.size);
    });

    it("reports an object missing from storage", async () => {
      const uploaded = await read(await upload(png()));
      await harness.mediaStorage.storage.delete(
        String(uploaded.media?.objectKey),
      );

      const body = await read(
        await requestJson(
          harness.app,
          cookie,
          "GET",
          `/api/media/${uploaded.media?.id ?? ""}?verify=true`,
        ),
      );

      expect(body.exists).toBe(false);
      expect(body.storage).toBeNull();
    });

    it("returns 404 for an unknown id", async () => {
      const response = await requestJson(
        harness.app,
        cookie,
        "GET",
        "/api/media/missing",
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/media/:id", () => {
    it("deletes an unused file", async () => {
      const uploaded = await read(await upload(png()));

      const response = await requestJson(
        harness.app,
        cookie,
        "DELETE",
        `/api/media/${uploaded.media?.id ?? ""}`,
      );

      expect(response.status).toBe(204);
      expect(harness.mediaStorage.keys()).toEqual([]);
    });

    it("refuses while a draft uses it", async () => {
      const uploaded = await read(await upload(png()));
      await requestJson(harness.app, cookie, "POST", "/api/documents", {
        collection: "blog",
        path: "src/content/blog/hello.md",
      });
      const drafts = (await (
        await requestJson(harness.app, cookie, "GET", "/api/documents")
      ).json()) as { documents: { id: string }[] };
      await requestJson(
        harness.app,
        cookie,
        "PATCH",
        `/api/documents/${drafts.documents[0]?.id ?? ""}`,
        { source: `![x](${uploaded.media?.url ?? ""})` },
      );

      const response = await requestJson(
        harness.app,
        cookie,
        "DELETE",
        `/api/media/${uploaded.media?.id ?? ""}`,
      );

      expect(response.status).toBe(409);
      expect((await read(response)).error?.code).toBe("in_use");
      expect(harness.mediaStorage.keys()).toHaveLength(1);
    });

    it("refuses a file that is live on the base branch", async () => {
      // No draft mentions it; only published content on main does. Before
      // git references counted, this route deleted it (ADR-0021).
      const uploaded = await read(await upload(png()));
      createMediaRepository(harness.db).setGitReferences("main", [
        {
          mediaId: uploaded.media?.id ?? "",
          path: "src/content/blog/hello.md",
        },
      ]);

      const response = await requestJson(
        harness.app,
        cookie,
        "DELETE",
        `/api/media/${uploaded.media?.id ?? ""}`,
      );

      expect(response.status).toBe(409);
      expect((await read(response)).error?.code).toBe("in_use");
      expect(harness.mediaStorage.keys()).toHaveLength(1);
    });
  });

  describe("GET /api/media/:id/references", () => {
    it("reports where a media file is used", async () => {
      const uploaded = await read(await upload(png()));
      const mediaId = uploaded.media?.id ?? "";

      const response = await requestJson(
        harness.app,
        cookie,
        "GET",
        `/api/media/${mediaId}/references`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        references: { drafts: [], git: [] },
      });
    });

    it("refuses references for a media file that does not exist", async () => {
      const response = await requestJson(
        harness.app,
        cookie,
        "GET",
        "/api/media/missing/references",
      );

      expect(response.status).toBe(404);
    });

    it("reflects a draft reference added after the last recompute", async () => {
      // Draft references are only ever refreshed by recompute() — there is
      // no write-time hook. GET /:id/references must trigger that refresh
      // itself, or a file just wired into a draft still reads as unused.
      const uploaded = await read(await upload(png()));
      const mediaId = uploaded.media?.id ?? "";

      // An unrelated earlier read (e.g. GET /) already ran a recompute
      // before this draft existed, so any per-request cache would be stale.
      await requestJson(harness.app, cookie, "GET", "/api/media");

      await requestJson(harness.app, cookie, "POST", "/api/documents", {
        collection: "blog",
        path: "src/content/blog/hello.md",
      });
      const drafts = (await (
        await requestJson(harness.app, cookie, "GET", "/api/documents")
      ).json()) as { documents: { id: string }[] };
      await requestJson(
        harness.app,
        cookie,
        "PATCH",
        `/api/documents/${drafts.documents[0]?.id ?? ""}`,
        { source: `![x](${uploaded.media?.url ?? ""})` },
      );

      const response = await requestJson(
        harness.app,
        cookie,
        "GET",
        `/api/media/${mediaId}/references`,
      );

      const body = (await response.json()) as {
        references: { drafts: unknown[]; git: unknown[] };
      };
      expect(body.references.drafts).toHaveLength(1);
    });
  });

  describe("when storage is not configured", () => {
    it("answers 404 on every media route", async () => {
      const app = buildTestApp({ mediaEnabled: false });
      const session = await signIn(app.app, "Ada");

      const response = await requestJson(app.app, session, "GET", "/api/media");

      expect(response.status).toBe(404);
      expect(((await response.json()) as MediaBody).error?.code).toBe(
        "media_disabled",
      );
    });
  });
});
