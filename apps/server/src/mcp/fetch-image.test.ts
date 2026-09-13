import { describe, expect, it, vi } from "vitest";
import {
  createImageFetcher,
  ImageFetchError,
  isPrivateAddress,
} from "./fetch-image.ts";

const PUBLIC = { address: "93.184.216.34" };

function fetcher(
  response: Response,
  address = PUBLIC,
  maxBytes?: number,
): ReturnType<typeof createImageFetcher> {
  return createImageFetcher({
    fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
    lookup: () => Promise.resolve(address),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
}

function imageResponse(bytes = new Uint8Array([1, 2, 3])): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

async function errorOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "(no error)";
  } catch (error) {
    if (error instanceof ImageFetchError) return error.message;
    throw error;
  }
}

describe("isPrivateAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["224.0.0.1", true],
    ["::1", true],
    ["fe80::1", true],
    ["fd00::1", true],
    ["::ffff:127.0.0.1", true],
    ["not-an-ip", true],
    ["93.184.216.34", false],
    ["172.32.0.1", false],
    ["2606:2800:220:1::1", false],
  ])("%s -> %s", (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe("createImageFetcher", () => {
  it("fetches a public image and names it from the URL", async () => {
    const fetch = fetcher(imageResponse());

    const result = await fetch("https://example.com/photos/hero.png");

    expect(result.filename).toBe("hero.png");
    expect([...result.bytes]).toEqual([1, 2, 3]);
  });

  it("prefers a caller-supplied filename", async () => {
    const fetch = fetcher(imageResponse());

    const result = await fetch("https://example.com/x", "chosen.png");

    expect(result.filename).toBe("chosen.png");
  });

  it.each([
    ["file:///etc/passwd", /only http/i],
    ["gopher://example.com/x", /only http/i],
    ["not a url", /not a valid url/i],
  ])("refuses %s", async (url, pattern) => {
    const fetch = fetcher(imageResponse());

    expect(await errorOf(() => fetch(url))).toMatch(pattern);
  });

  it("refuses an address that is not publicly routable", async () => {
    const fetch = fetcher(imageResponse(), { address: "127.0.0.1" });

    expect(await errorOf(() => fetch("http://localhost/x.png"))).toMatch(
      /not publicly routable/i,
    );
  });

  it("refuses a redirect rather than following it", async () => {
    const fetch = fetcher(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/" },
      }),
    );

    expect(await errorOf(() => fetch("https://example.com/x.png"))).toMatch(
      /redirect/i,
    );
  });

  it("passes on a failed response", async () => {
    const fetch = fetcher(new Response("nope", { status: 404 }));

    expect(await errorOf(() => fetch("https://example.com/x.png"))).toMatch(
      /404/,
    );
  });

  it("refuses a file over the limit", async () => {
    const fetch = fetcher(imageResponse(new Uint8Array(50)), PUBLIC, 10);

    expect(await errorOf(() => fetch("https://example.com/x.png"))).toMatch(
      /too large/i,
    );
  });
});
