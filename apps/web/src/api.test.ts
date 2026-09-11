import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  chooseDisplayName,
  getRepositoryStatus,
  getSession,
  login,
  logout,
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
