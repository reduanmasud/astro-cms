import {
  parseDocument,
  serializeDocument,
  type EditorDoc,
} from "@astro-cms/markdown";
import { signCollabToken } from "../collab/jwt.ts";
import { isValidSignature } from "../collab/signature.ts";
import type { CollaborationConfig } from "../config.ts";
import type { CmsDocument, CollaboratorRef } from "../documents/model.ts";
import { DocumentError, type DocumentService } from "./documents.ts";

/**
 * Live editing through a HocusPocus server that runs outside this process
 * (docs/adr/0016-collaboration-service.md).
 *
 * The CMS hands out short-lived tokens, and HocusPocus calls back over a
 * signed webhook. Authentication and room isolation happen in HocusPocus's
 * `onAuthenticate`, which verifies the token and its room; the webhook then
 * carries the collaborator as connection context. SQLite stays the durable
 * store: every `change` becomes Markdown on the draft. GitHub is never
 * touched here.
 */

/** The field HocusPocus and Tiptap use for the shared document. */
export const COLLAB_FIELD = "default";

export interface CollabConnection {
  /** WebSocket URL for the browser. */
  readonly url: string;
  /** The room, which is the draft's id. */
  readonly room: string;
  readonly token: string;
  readonly expiresAt: number;
}

export type WebhookEvent = "connect" | "create" | "change" | "disconnect";

export interface WebhookRequest {
  readonly body: string;
  readonly signature: string | undefined;
}

export type WebhookResult =
  | { readonly ok: true; readonly status: 200; readonly body: unknown }
  | {
      readonly ok: false;
      readonly status: 401 | 403 | 404;
      readonly message: string;
    };

export interface CollabService {
  isEnabled(): boolean;
  /** A token for this collaborator to edit this draft. Throws if the draft is unknown. */
  issueConnection(
    documentId: string,
    collaborator: CollaboratorRef,
  ): Promise<CollabConnection>;
  /** Handles one signed webhook call from HocusPocus. */
  handleWebhook(request: WebhookRequest): Promise<WebhookResult>;
}

interface Deps {
  config: CollaborationConfig | null;
  documents: DocumentService;
  now?: () => number;
}

export function createCollabService({
  config,
  documents,
  now = Date.now,
}: Deps): CollabService {
  function requireConfig(): CollaborationConfig {
    if (config === null) {
      throw new DocumentError(
        "invalid",
        "Collaboration is not configured on this server.",
      );
    }
    return config;
  }

  return {
    isEnabled: () => config !== null,

    async issueConnection(documentId, collaborator) {
      const settings = requireConfig();
      const document = documents.get(documentId);

      const { token, expiresAt } = await signCollabToken({
        secret: settings.jwtSecret,
        room: document.id,
        collaboratorId: collaborator.id,
        name: collaborator.name,
        now,
      });
      return { url: settings.publicUrl, room: document.id, token, expiresAt };
    },

    handleWebhook({ body, signature }) {
      const settings = requireConfig();
      if (!isValidSignature(settings.webhookSecret, body, signature)) {
        return Promise.resolve({
          ok: false as const,
          status: 401 as const,
          message: "Invalid webhook signature.",
        });
      }

      const request = parseWebhookBody(body);
      if (request === undefined) {
        return Promise.resolve({
          ok: false as const,
          status: 404 as const,
          message: "Unrecognised webhook payload.",
        });
      }
      const { event, documentName, document } = request;

      switch (event) {
        case "connect":
          return Promise.resolve(acknowledge(documents, documentName));
        case "create":
          // The browser seeds a new room from the draft it already loaded, so
          // nothing here has to rebuild our schema.
          return Promise.resolve({ ok: true, status: 200, body: {} });
        case "change":
          return Promise.resolve(
            save(documents, documentName, document, request.context),
          );
        default:
          return Promise.resolve({ ok: true, status: 200, body: {} });
      }
    },
  };
}

/**
 * The contract does not ask for the `connect` event, because HocusPocus turns
 * a failed connect webhook into a refused connection, which would stop all
 * editing whenever the CMS is unreachable. A deployment that sends it anyway
 * gets an honest answer: does this room name a draft?
 */
function acknowledge(
  documents: DocumentService,
  documentName: string,
): WebhookResult {
  return findDraft(documents, documentName) === undefined
    ? { ok: false, status: 404, message: "No draft with that id." }
    : { ok: true, status: 200, body: {} };
}

function save(
  documents: DocumentService,
  documentName: string,
  document: Record<string, unknown> | undefined,
  context: Record<string, unknown>,
): WebhookResult {
  const content = document?.[COLLAB_FIELD];
  if (!isEditorDoc(content)) {
    return {
      ok: false,
      status: 404,
      message: "The webhook carried no document content.",
    };
  }

  // A room for a draft that no longer exists must not recreate it.
  const draft = findDraft(documents, documentName);
  if (draft === undefined) {
    return { ok: false, status: 404, message: "No draft with that id." };
  }
  const { frontmatter } = parseDocument(draft.source, draft.format);
  const source = serializeDocument({ frontmatter, doc: content }, draft.format);
  // No expectedRevision: while a room is open, HocusPocus holds the newest text.
  documents.update(
    draft.id,
    { source },
    collaboratorFrom(context) ?? draft.updatedBy,
  );
  return { ok: true, status: 200, body: { saved: true } };
}

interface WebhookBody {
  readonly event: WebhookEvent;
  readonly documentName: string;
  readonly document?: Record<string, unknown>;
  /** The connection context HocusPocus built in `onAuthenticate`. */
  readonly context: Record<string, unknown>;
}

/** HocusPocus sends `{ event, payload: { documentName, document, requestParameters } }`. */
function parseWebhookBody(body: string): WebhookBody | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const event = parsed.event;
  const payload = isRecord(parsed.payload) ? parsed.payload : undefined;
  const documentName = payload?.documentName;
  if (typeof event !== "string" || typeof documentName !== "string")
    return undefined;

  return {
    event: event as WebhookEvent,
    documentName,
    document: isRecord(payload?.document) ? payload.document : undefined,
    context: isRecord(payload?.context) ? payload.context : {},
  };
}

/** The collaborator HocusPocus attached to the connection, if it sent one. */
function collaboratorFrom(
  context: Record<string, unknown>,
): CollaboratorRef | undefined {
  const id = context.collaboratorId;
  const name = context.name;
  return typeof id === "string" && typeof name === "string"
    ? { id, name }
    : undefined;
}

/** Returns the draft, or undefined when the room outlived it. */
function findDraft(
  documents: DocumentService,
  id: string,
): CmsDocument | undefined {
  try {
    return documents.get(id);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEditorDoc(value: unknown): value is EditorDoc {
  return (
    isRecord(value) && value.type === "doc" && Array.isArray(value.content)
  );
}
