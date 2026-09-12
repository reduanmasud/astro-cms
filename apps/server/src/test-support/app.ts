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

export const TEST_JWT_SECRET = "collab-jwt-secret-that-is-long-enough";
export const TEST_WEBHOOK_SECRET = "collab-webhook-secret-long-enough!!";

export interface TestAppOptions {
  db?: Db;
  /** Pass a URL to switch collaboration on for the test app. */
  collaborationUrl?: string;
  /** Set false to run without media storage. */
  mediaEnabled?: boolean;
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
  const documents = createDocumentService({
    repository: createDocumentRepository(db),
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
    sessionSecret: options.secret ?? TEST_SECRET,
    cookieSecure: false,
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
