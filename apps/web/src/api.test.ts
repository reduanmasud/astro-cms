import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  chooseDisplayName,
  deleteMedia,
  getMediaReferences,
  getRepositoryStatus,
  getSession,
  getDrift,
  listMedia,
  login,
  logout,
  publishDocument,
  resyncDocument,
  uploadMedia,
} from "./api.ts";

function mockFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastRequest(fetchMock: ReturnType<typeof mockFetch>) {
  const [path, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { path, init };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getSession", () => {
  it("returns the session when signed in", async () => {
    mockFetch(200, { collaborator: { id: "c1", name: "Ada" } });

    await expect(getSession()).resolves.toEqual({
      collaborator: { id: "c1", name: "Ada" },
    });
  });

  it("returns undefined when signed out", async () => {
    mockFetch(401, {
      error: { code: "unauthenticated", message: "Sign in to continue." },
    });

    await expect(getSession()).resolves.toBeUndefined();
  });

  it("throws other errors", async () => {
    mockFetch(500, {
      error: { code: "internal_error", message: "Something went wrong." },
    });

    await expect(getSession()).rejects.toThrow("Something went wrong.");
  });
});

describe("login", () => {
  it("posts only the password as JSON", async () => {
    const fetchMock = mockFetch(200, { collaborator: null });

    await login("correct-horse-battery");

    const { path, init } = lastRequest(fetchMock);
    expect(path).toBe("/api/session");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ password: "correct-horse-battery" }),
    );
  });

  it("surfaces the server error code and message", async () => {
    mockFetch(401, {
      error: { code: "invalid_password", message: "Incorrect password." },
    });

    const error = await login("nope").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "invalid_password" });
  });

  it("falls back to a generic message when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("<html>", { status: 502 })),
    );

    await expect(login("x")).rejects.toThrow("Request failed (502).");
  });
});

describe("chooseDisplayName", () => {
  it("puts the name and returns the collaborator", async () => {
    const fetchMock = mockFetch(200, {
      collaborator: { id: "c1", name: "Ada" },
    });

    await expect(chooseDisplayName("Ada")).resolves.toEqual({
      id: "c1",
      name: "Ada",
    });
    const { path, init } = lastRequest(fetchMock);
    expect(path).toBe("/api/session/display-name");
    expect(init?.method).toBe("PUT");
  });
});

describe("getRepositoryStatus", () => {
  it("fetches the repository status", async () => {
    const status = { fullName: "acme/blog", checks: [] };
    const fetchMock = mockFetch(200, status);

    await expect(getRepositoryStatus()).resolves.toEqual(status);
    expect(lastRequest(fetchMock).path).toBe("/api/repository");
  });
});

describe("logout", () => {
  it("sends DELETE and resolves on 204", async () => {
    const fetchMock = mockFetch(204);

    await expect(logout()).resolves.toBeUndefined();
    expect(lastRequest(fetchMock).init?.method).toBe("DELETE");
  });
});

describe("uploadMedia", () => {
  const png = (): File =>
    new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

  it("sends the file as multipart, letting the browser set the boundary", async () => {
    const fetchMock = mockFetch(201, {
      media: { id: "m1", url: "https://media.test/a.png" },
      created: true,
    });

    await expect(uploadMedia(png())).resolves.toMatchObject({ created: true });

    const { path, init } = lastRequest(fetchMock);
    expect(path).toBe("/api/media");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    // A Content-Type of our own would break the multipart boundary.
    expect(init?.headers).toBeUndefined();
  });

  it("surfaces the server's reason for refusing a file", async () => {
    mockFetch(415, {
      error: {
        code: "unsupported_type",
        message: "Only PNG, JPEG, GIF, WebP, and AVIF images are accepted.",
      },
    });

    const error = await uploadMedia(png()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 415, code: "unsupported_type" });
  });
});

describe("publishDocument", () => {
  it("posts to the publish route", async () => {
    const fetchMock = mockFetch(200, {
      pullRequest: { number: 3, url: "https://github.com/acme/blog/pull/3" },
      commitSha: "sha0002",
      createdBranch: true,
      createdPullRequest: true,
    });

    await expect(publishDocument("d1")).resolves.toMatchObject({
      createdBranch: true,
    });

    const { path, init } = lastRequest(fetchMock);
    expect(path).toBe("/api/documents/d1/publish");
    expect(init?.method).toBe("POST");
  });

  it("surfaces drift as an ApiError carrying the conflict", async () => {
    mockFetch(409, {
      error: {
        code: "drift",
        message: "the base branch moved",
        drift: { drifted: true, baseContent: "# Theirs\n" },
      },
    });

    const error = await publishDocument("d1").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "drift" });
  });
});

describe("getDrift and resyncDocument", () => {
  it("reads and then clears drift", async () => {
    const readMock = mockFetch(200, {
      drifted: true,
      baseCommitSha: "sha0001",
      headSha: "sha0009",
      baseContent: "# Theirs\n",
    });
    await expect(getDrift("d1")).resolves.toMatchObject({ drifted: true });
    expect(lastRequest(readMock).path).toBe("/api/documents/d1/drift");

    const resyncMock = mockFetch(200, { baseCommitSha: "sha0009" });
    await expect(resyncDocument("d1")).resolves.toEqual({
      baseCommitSha: "sha0009",
    });
    expect(lastRequest(resyncMock).init?.method).toBe("POST");
  });
});

describe("media", () => {
  it("asks for one page of unused media", async () => {
    const fetchMock = mockFetch(200, { media: [] });

    await listMedia({ unused: true, limit: 24, offset: 24 });

    expect(lastRequest(fetchMock).path).toBe(
      "/api/media?unused=true&limit=24&offset=24",
    );
  });

  it("sends no query string when nothing is filtered", async () => {
    const fetchMock = mockFetch(200, { media: [] });

    await listMedia();

    expect(lastRequest(fetchMock).path).toBe("/api/media");
  });

  it("omits the filter rather than sending unused=false", async () => {
    const fetchMock = mockFetch(200, { media: [] });

    await listMedia({ unused: false, limit: 24 });

    expect(lastRequest(fetchMock).path).toBe("/api/media?limit=24");
  });

  it("asks where one file is used", async () => {
    const fetchMock = mockFetch(200, {
      references: { drafts: [], git: [] },
    });

    await getMediaReferences("m1");

    expect(lastRequest(fetchMock).path).toBe("/api/media/m1/references");
  });

  it("deletes one file", async () => {
    const fetchMock = mockFetch(204);

    await deleteMedia("m1");

    const { path, init } = lastRequest(fetchMock);
    expect(path).toBe("/api/media/m1");
    expect(init).toMatchObject({ method: "DELETE" });
  });
});
