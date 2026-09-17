import {
  fromJsonSchema,
  type CallToolResult,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { CollaboratorRef } from "../documents/model.ts";
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

/** MCP has no display name, so its writes are attributed to one fixed row. */
const MCP_COLLABORATOR = "MCP";

export function registerTools(server: McpServer, deps: McpDeps): void {
  const actor = (): CollaboratorRef =>
    deps.collaborators.claim(MCP_COLLABORATOR);

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

  server.registerTool(
    "create_document",
    {
      description:
        "Open a repository path as a CMS draft, copying the file from the base branch when it exists. GitHub is only read.",
      inputSchema: fromJsonSchema<{ collection: string; path: string }>({
        type: "object",
        properties: {
          collection: {
            type: "string",
            description: "Collection name, e.g. blog",
          },
          path: {
            type: "string",
            description: "Repository path, e.g. src/content/blog/hello.md",
          },
        },
        required: ["collection", "path"],
      }),
    },
    ({ collection, path }) =>
      run(() => deps.drafts.open({ collection, path }, actor())),
  );

  server.registerTool(
    "update_document",
    {
      description:
        "Save a draft's Markdown/MDX source, slug, or status. Nothing reaches GitHub until it is published.",
      inputSchema: fromJsonSchema<{
        id: string;
        source?: string;
        slug?: string;
        status?: string;
      }>({
        type: "object",
        properties: {
          id: { type: "string" },
          source: {
            type: "string",
            description: "The whole file, frontmatter included",
          },
          slug: { type: "string" },
          status: { type: "string", enum: ["draft", "in_review", "published"] },
        },
        required: ["id"],
      }),
    },
    ({ id, source, slug, status }) =>
      run(() =>
        deps.documents.update(
          id,
          { source, slug, status } as Parameters<DocumentService["update"]>[1],
          actor(),
        ),
      ),
  );

  server.registerTool(
    "delete_document",
    {
      description: "Delete a CMS draft. GitHub is not touched.",
      inputSchema: fromJsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
    },
    ({ id }) =>
      run(() => {
        deps.documents.delete(id);
        return { deleted: id };
      }),
  );

  server.registerTool(
    "publish_document",
    {
      description:
        "Commit the draft to its CMS branch and open or update its pull request. Stops if the base branch moved.",
      inputSchema: fromJsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
    },
    ({ id }) => run(() => deps.publish.publish(id, actor())),
  );

  server.registerTool(
    "resync_document",
    {
      description:
        "Adopt the current base-branch commit as this draft's baseline, after reviewing the difference.",
      inputSchema: fromJsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
    },
    ({ id }) => run(() => deps.publish.resync(id)),
  );

  server.registerTool(
    "get_publish_status",
    {
      description:
        "Ask GitHub about this draft's pull request and update its status.",
      inputSchema: fromJsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
    },
    ({ id }) => run(() => deps.publish.refresh(id)),
  );

  server.registerTool(
    "get_pull_request",
    {
      description: "One pull request by number.",
      inputSchema: fromJsonSchema<{ number: number }>({
        type: "object",
        properties: { number: { type: "integer", minimum: 1 } },
        required: ["number"],
      }),
    },
    ({ number }) =>
      run(async () => {
        const pr = await deps.repository.getPullRequest(number);
        if (!pr) throw new Error(`No pull request ${String(number)}.`);
        return pr;
      }),
  );

  server.registerTool(
    "list_media",
    {
      description:
        "Stored media, newest first. `unused` lists only files nothing references—neither a draft nor a branch.",
      inputSchema: fromJsonSchema<{
        unused?: boolean;
        limit?: number;
        offset?: number;
      }>({
        type: "object",
        properties: {
          unused: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 200 },
          offset: { type: "integer", minimum: 0 },
        },
      }),
    },
    ({ unused, limit, offset }) =>
      run(() => deps.media.list({ unusedOnly: unused, limit, offset })),
  );

  server.registerTool(
    "get_media",
    {
      description: "One media item with its public URL, size, and dimensions.",
      inputSchema: fromJsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
    },
    ({ id }) => run(() => deps.media.get(id)),
  );

  server.registerTool(
    "get_media_references",
    {
      description:
        "Where one media file is used: the drafts that reference it, and the repository refs and paths that do.",
      inputSchema: fromJsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
    },
    ({ id }) => run(() => deps.media.references(id)),
  );

  server.registerTool(
    "upload_media",
    {
      description:
        "Fetch an image from a public URL, store it, and return its public URL for embedding in content. Only http/https, and only publicly routable addresses.",
      inputSchema: fromJsonSchema<{ url: string; filename?: string }>({
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Public http(s) URL of the image",
          },
          filename: {
            type: "string",
            description: "Optional name to store it under",
          },
        },
        required: ["url"],
      }),
    },
    ({ url, filename }) =>
      run(async () => {
        // The same inspection, dedup and storage a browser paste goes through.
        const fetched = await deps.fetchImage(url, filename);
        return deps.media.upload(
          { filename: fetched.filename, bytes: fetched.bytes },
          actor(),
        );
      }),
  );

  server.registerTool(
    "delete_media",
    {
      description: "Delete a media file. Refused while a draft still uses it.",
      inputSchema: fromJsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
    },
    ({ id }) =>
      run(async () => {
        await deps.media.delete(id);
        return { deleted: id };
      }),
  );
}
