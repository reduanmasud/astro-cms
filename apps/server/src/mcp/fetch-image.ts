import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MAX_UPLOAD_BYTES } from "../media/inspect.ts";

/**
 * Fetching a caller-supplied URL from inside the server is a request-forgery
 * hazard: an MCP client could aim it at a cloud metadata endpoint or at
 * something reachable only from the CMS's network, and read the answer back
 * through the CMS. Everything here exists to make that hard
 * (docs/superpowers/specs/2026-09-13-mcp-design.md).
 */

export class ImageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageFetchError";
  }
}

export interface FetchedImage {
  readonly bytes: Uint8Array;
  readonly filename: string;
}

export type ImageFetcher = (
  url: string,
  filename?: string,
) => Promise<FetchedImage>;

export interface ImageFetcherDeps {
  fetch?: typeof globalThis.fetch;
  lookup?: (host: string) => Promise<{ address: string }>;
  maxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_FILENAME_LENGTH = 200;

/** True for anything that is not a publicly routable address. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // Link-local, which is where cloud metadata endpoints live.
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    // Multicast and reserved space.
    if (a >= 224) return true;
    return false;
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1] !== undefined) return isPrivateAddress(mapped[1]);
    if (lower === "::" || lower === "::1") return true;
    // Link-local, unique-local, and multicast.
    return /^(fe[89ab]|f[cd]|ff)/.test(lower);
  }

  // Not an address at all: refuse rather than guess.
  return true;
}

/** The last path segment, or "image" when the URL has none worth using. */
function filenameFrom(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const cleaned = last.replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned === "" ? "image" : cleaned.slice(0, MAX_FILENAME_LENGTH);
}

export function createImageFetcher({
  fetch = globalThis.fetch,
  lookup = (host) => dnsLookup(host),
  maxBytes = MAX_UPLOAD_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ImageFetcherDeps = {}): ImageFetcher {
  return async function fetchImage(rawUrl, filename) {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ImageFetchError(`"${rawUrl}" is not a valid URL.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ImageFetchError("Only http and https URLs can be fetched.");
    }

    const host = url.hostname.replace(/^\[|\]$/g, "");
    const { address } = isIP(host) ? { address: host } : await lookup(host);
    if (isPrivateAddress(address)) {
      throw new ImageFetchError(
        `${host} resolves to ${address}, which is not publicly routable.`,
      );
    }

    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "image/*" },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new ImageFetchError(
        "The URL redirects, and redirects are not followed.",
      );
    }
    if (!response.ok) {
      throw new ImageFetchError(
        `Fetching the image failed (${String(response.status)}).`,
      );
    }

    // Checked twice: the header can lie, or be missing entirely.
    if (Number(response.headers.get("Content-Length") ?? "0") > maxBytes) {
      throw new ImageFetchError("The image is too large.");
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new ImageFetchError("The image is too large.");
    }

    return {
      bytes: new Uint8Array(buffer),
      filename: filename ?? filenameFrom(url),
    };
  };
}
