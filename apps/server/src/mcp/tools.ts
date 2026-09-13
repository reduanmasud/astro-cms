import {
  fromJsonSchema,
  type CallToolResult,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { AstroProjectService } from "../services/astro-project.ts";
import type { CollaboratorService } from "../services/collaborators.ts";
import type { DocumentService } from "../services/documents.ts";
import type { DraftOpener } from "../services/draft-opener.ts";
import type { MediaService } from "../services/media.ts";
import type { PublishService } from "../services/publish.ts";
import type { RepositoryService } from "../services/repository.ts";
import type { ImageFetcher } from "./fetch-image.ts";

/**
 * MCP tools. Each one validates, calls a service, and formats the result; the
 * business rules stay in the services the web UI also calls
 * (docs/adr/0011-shared-service-layer.md).
 */

export interface McpDeps {
  project: AstroProjectService;
  documents: DocumentService;
  drafts: DraftOpener;
  publish: PublishService;
  media: MediaService;
  repository: RepositoryService;
  collaborators: CollaboratorService;
  fetchImage: ImageFetcher;
}

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failed(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Service errors become tool errors: a model can read a sentence and retry. */
async function run(work: () => unknown): Promise<CallToolResult> {
  try {
    return ok(await work());
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "Something went wrong.",
    );
  }
}

const NO_ARGUMENTS = { type: "object", properties: {} } as const;

export function registerTools(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    "get_project",
    {
      description:
        "The Astro project: whether it is Astro, its config paths, version, and collections.",
      inputSchema: fromJsonSchema(NO_ARGUMENTS),
    },
    () => run(() => deps.project.discover()),
  );

  server.registerTool(
    "get_repository",
    {
      description:
        "The connected GitHub repository, its checks, and its stats.",
      inputSchema: fromJsonSchema(NO_ARGUMENTS),
    },
    () => run(() => deps.repository.getStatus()),
  );

  server.registerTool(
    "list_collections",
    {
      description: "The Astro content collections this project declares.",
      inputSchema: fromJsonSchema(NO_ARGUMENTS),
    },
    () => run(async () => (await deps.project.discover()).collections),
  );

  server.registerTool(
    "get_collection_schema",
    {
      description:
        "One collection: its schema fields, supported formats, and existing entries.",
      inputSchema: fromJsonSchema<{ collection: string }>({
        type: "object",
        properties: {
          collection: {
            type: "string",
            description: "Collection name, e.g. blog",
          },
        },
        required: ["collection"],
      }),
    },
    ({ collection }) =>
      run(async () => {
        const detail = await deps.project.getCollection(collection);
        if (!detail) throw new Error(`No collection named "${collection}".`);
        return detail;
      }),
  );

  server.registerTool(
    "list_documents",
    {
      description: "CMS drafts, optionally filtered by collection or status.",
      inputSchema: fromJsonSchema<{
        collection?: string;
        status?: string;
        limit?: number;
        offset?: number;
      }>({
        type: "object",
        properties: {
          collection: { type: "string" },
          status: { type: "string", enum: ["draft", "in_review", "published"] },
          limit: { type: "integer", minimum: 1, maximum: 200 },
          offset: { type: "integer", minimum: 0 },
        },
      }),
    },
    (args) =>
      run(() =>
        deps.documents.list(args as Parameters<DocumentService["list"]>[0]),
      ),
  );

  server.registerTool(
    "search_documents",
    {
      description: "Search drafts by path, slug, or content.",
      inputSchema: fromJsonSchema<{ query: string }>({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      }),
    },
    ({ query }) => run(() => deps.documents.search(query)),
  );

  server.registerTool(
    "get_document",
    {
      description: "One draft with its full Markdown or MDX source.",
      inputSchema: fromJsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
    },
    ({ id }) => run(() => deps.documents.get(id)),
  );
}
