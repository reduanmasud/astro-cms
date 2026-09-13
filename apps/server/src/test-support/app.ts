import { createApp } from "../app.ts";
import { openDatabase, type Db } from "../db/database.ts";
import { createDocumentRepository } from "../db/document-repository.ts";
import { createMediaRepository } from "../db/media-repository.ts";
import { createFakeGitHubClient, type FakeGitHub } from "../github/fake.ts";
import { createRateLimiter } from "../lib/rate-limiter.ts";
import { createAstroProjectService } from "../services/astro-project.ts";
import { createFakeStorage, type FakeStorage } from "../media/fake-storage.ts";
import { createCollabService } from "../services/collab.ts";
import { createMediaService } from "../services/media.ts";
import { createMediaReferenceTracker } from "../services/media-references.ts";
import { createCollaboratorService } from "../services/collaborators.ts";
import {
  createDocumentService,
  type DocumentService,
} from "../services/documents.ts";
import { createDraftOpener } from "../services/draft-opener.ts";
import { createHealthService } from "../services/health.ts";
import { createPublishService } from "../services/publish.ts";
import { createRepositoryService } from "../services/repository.ts";
import { createSessionService } from "../services/sessions.ts";

export const TEST_PASSWORD = "correct-horse-battery";
export const TEST_SECRET = "test-session-secret-that-is-long-enough";

export const TEST_CONTENT_CONFIG = `
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({ title: z.string(), draft: z.boolean().optional() }),
});

export const collections = { blog };
`;

/** A small Astro repository used by route tests. */
export const TEST_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ dependencies: { astro: "^5.4.0" } }),
  "astro.config.mjs": "export default {};\n",
  "src/content.config.ts": TEST_CONTENT_CONFIG,
  "src/content/blog/hello.md": "---\ntitle: Hello\n---\n\n# Hello\n",
};

export const TEST_MCP_TOKEN = "mcp-test-token-that-is-long-enough";

/** A 1x1 PNG, so upload_media can be tested without the network. */
export const TEST_IMAGE_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

export const TEST_JWT_SECRET = "collab-jwt-secret-that-is-long-enough";
export const TEST_WEBHOOK_SECRET = "collab-webhook-secret-long-enough!!";

export interface TestAppOptions {
  db?: Db;
  /** Pass a URL to switch collaboration on for the test app. */
  collaborationUrl?: string;
  /** Set false to run without media storage. */
  mediaEnabled?: boolean;
  /** Pass a token to switch the MCP endpoint on. */
  mcpToken?: string;
  loginLimit?: number;
  secret?: string;
  files?: Record<string, string>;
}

export interface TestApp {
  app: ReturnType<typeof createApp>;
  db: Db;
  github: FakeGitHub;
  mediaStorage: FakeStorage;
  /** The same draft storage the app uses, for assertions. */
  documents: DocumentService;
}

export function buildTestApp(options: TestAppOptions = {}): TestApp {
  const db = options.db ?? openDatabase(":memory:");
  const github = createFakeGitHubClient({ files: options.files ?? TEST_FILES });
  const repository = createRepositoryService({
    github: github.client,
    baseBranch: "main",
  });
  const collaborators = createCollaboratorService({ db });
  const project = createAstroProjectService({ repository });
  const documentRepository = createDocumentRepository(db);
  const documents = createDocumentService({ repository: documentRepository });
  const publish = createPublishService({
    documents,
    documentRepository,
    repository,
  });

  const mediaRepository = createMediaRepository(db);
  const mediaStorage = createFakeStorage();
  const media = createMediaService({
    repository: mediaRepository,
    storage: options.mediaEnabled === false ? null : mediaStorage.storage,
  });
  const mediaReferences = createMediaReferenceTracker({
    repository: mediaRepository,
    documents,
    publicUrl: "https://media.test",
  });

  const app = createApp({
    health: createHealthService({ db }),
    repository,
    project,
    documents,
    drafts: createDraftOpener({ documents, repository, project }),
    publish,
    media,
    mediaReferences,
    collab: createCollabService({
      config:
        options.collaborationUrl === undefined
          ? null
          : {
              publicUrl: options.collaborationUrl,
              internalUrl: options.collaborationUrl,
              jwtSecret: TEST_JWT_SECRET,
              webhookSecret: TEST_WEBHOOK_SECRET,
            },
      documents,
    }),
    sessions: createSessionService({
      db,
      password: TEST_PASSWORD,
      collaborators,
    }),
    loginLimiter: createRateLimiter({
      limit: options.loginLimit ?? 100,
      windowMs: 60_000,
    }),
    collaborators,
    sessionSecret: options.secret ?? TEST_SECRET,
    cookieSecure: false,
    fetchImage: (_url, filename) =>
      Promise.resolve({
        bytes: TEST_IMAGE_BYTES,
        filename: filename ?? "fetched.png",
      }),
    mcpToken: options.mcpToken ?? null,
  });
  return { app, db, github, documents, mediaStorage };
}

type App = TestApp["app"];

/** Logs in (and optionally picks a display name); returns the `cms_session=...` cookie pair. */
export async function signIn(app: App, name?: string): Promise<string> {
  const response = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  const cookie = (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
  if (!cookie.startsWith("cms_session=")) throw new Error("Sign-in failed");
  if (name !== undefined) {
    await app.request("/api/session/display-name", {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }
  return cookie;
}

/** Sends a JSON request with the session cookie. */
export function requestJson(
  app: App,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: {
        Cookie: cookie,
        "Sec-Fetch-Site": "same-origin",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export interface McpResponse {
  status: number;
  body?: {
    result?: {
      tools?: { name: string; inputSchema: unknown }[];
      content?: { type: string; text: string }[];
      isError?: boolean;
    };
    error?: { code: number; message: string };
  };
}

/** One JSON-RPC call against /api/mcp. Responses are server-sent events. */
export async function mcpCall(
  app: App,
  token: string,
  method: string,
  params: unknown,
): Promise<McpResponse> {
  const response = await app.request("/api/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  const line = text.split("\n").find((row) => row.startsWith("data:"));
  return {
    status: response.status,
    body:
      line === undefined
        ? undefined
        : (JSON.parse(line.slice(5).trim()) as McpResponse["body"]),
  };
}
