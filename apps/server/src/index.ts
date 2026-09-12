import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { createDocumentRepository } from "./db/document-repository.ts";
import { createMediaRepository } from "./db/media-repository.ts";
import { createHttpGitHubClient } from "./github/http-client.ts";
import { createS3Storage } from "./media/s3-storage.ts";
import { createRateLimiter } from "./lib/rate-limiter.ts";
import { createAstroProjectService } from "./services/astro-project.ts";
import { createCollabService } from "./services/collab.ts";
import { createCollaboratorService } from "./services/collaborators.ts";
import { createDocumentService } from "./services/documents.ts";
import { createDraftOpener } from "./services/draft-opener.ts";
import { createMediaService } from "./services/media.ts";
import { createMediaReferenceTracker } from "./services/media-references.ts";
import { createHealthService } from "./services/health.ts";
import {
  createRepositoryService,
  RepositoryError,
} from "./services/repository.ts";
import { createSessionService } from "./services/sessions.ts";

const LOGIN_ATTEMPTS_PER_WINDOW = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  // Fail fast: the CMS is useless without its one repository.
  const repository = createRepositoryService({
    github: createHttpGitHubClient(config.github),
    baseBranch: config.github.baseBranch,
    fullName: `${config.github.owner}/${config.github.repository}`,
  });
  const access = await repository.verifyAccess();
  console.info(
    `Connected to ${access.fullName} (${access.baseBranch} @ ${access.headSha.slice(0, 7)})`,
  );

  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, "cms.sqlite"));
  const collaborators = createCollaboratorService({ db });
  const project = createAstroProjectService({ repository });
  const documents = createDocumentService({
    repository: createDocumentRepository(db),
  });

  const mediaRepository = createMediaRepository(db);
  const storage =
    config.storage === null ? null : createS3Storage(config.storage);
  const media = createMediaService({ repository: mediaRepository, storage });
  const mediaReferences = createMediaReferenceTracker({
    repository: mediaRepository,
    documents,
    publicUrl: config.storage?.publicUrl ?? null,
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
      config: config.collaboration,
      documents,
    }),
    sessions: createSessionService({
      db,
      password: config.cmsPassword,
      collaborators,
    }),
    loginLimiter: createRateLimiter({
      limit: LOGIN_ATTEMPTS_PER_WINDOW,
      windowMs: LOGIN_WINDOW_MS,
    }),
    sessionSecret: config.sessionSecret,
    cookieSecure: config.cookieSecure,
  });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.info(`Astro CMS API listening on http://localhost:${info.port}`);
  });

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const known =
    error instanceof ConfigError || error instanceof RepositoryError;
  console.error(known ? error.message : error);
  process.exit(1);
});
