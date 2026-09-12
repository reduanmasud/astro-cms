import { Webhook, Events } from "@hocuspocus/extension-webhook";
import { Server, type Configuration } from "@hocuspocus/server";
import { jwtVerify } from "jose";

/**
 * A HocusPocus server for development, and the written contract for a
 * production one (docs/adr/0016-collaboration-service.md).
 *
 * It does two things the CMS depends on:
 *
 * 1. Verifies the CMS-issued JWT and refuses a token whose room (`aud`) is not
 *    the document being opened.
 * 2. Runs the webhook extension against the CMS, signing every request with
 *    the shared webhook secret.
 *
 * It never reads or writes the CMS database; SQLite stays the CMS's.
 */

export interface CollabServerOptions {
  /** Kept for callers that read it back; pass it to `listen(port)`. */
  /** Same value as the CMS's HOCUSPOCUS_JWT_SECRET. */
  readonly jwtSecret: string;
  /** Same value as the CMS's HOCUSPOCUS_WEBHOOK_SECRET. */
  readonly webhookSecret: string;
  /** The CMS webhook, e.g. http://server:3000/api/collab/webhook. */
  readonly webhookUrl: string;
  readonly port?: number;
  /** Milliseconds of quiet before a change is sent to the CMS. */
  readonly debounce?: number;
  readonly debounceMaxWait?: number;
}

export const DEFAULT_PORT = 1234;
const DEFAULT_DEBOUNCE_MS = 800;
const DEFAULT_DEBOUNCE_MAX_WAIT_MS = 5000;

export interface CollaboratorContext {
  readonly collaboratorId: string;
  readonly name: string;
}

export function createCollabServer({
  jwtSecret,
  webhookSecret,
  webhookUrl,
  port = DEFAULT_PORT,
  debounce = DEFAULT_DEBOUNCE_MS,
  debounceMaxWait = DEFAULT_DEBOUNCE_MAX_WAIT_MS,
}: CollabServerOptions): Server {
  const key = new TextEncoder().encode(jwtSecret);

  const configuration: Partial<Configuration> = {
    quiet: true,

    // The room is the token's audience, so one token opens one document.
    async onAuthenticate({ token, documentName }) {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ["HS256"],
        audience: documentName,
      });
      const name = payload.name;
      if (typeof payload.sub !== "string" || typeof name !== "string") {
        throw new Error("The token is missing the collaborator.");
      }
      return {
        collaboratorId: payload.sub,
        name,
      } satisfies CollaboratorContext;
    },

    extensions: [
      new Webhook({
        url: webhookUrl,
        secret: webhookSecret,
        debounce,
        debounceMaxWait,
        // `connect` is deliberately not used: HocusPocus treats a failed
        // connect webhook as forbidden, so a CMS outage would stop all
        // editing (docs/adr/0016-collaboration-service.md).
        events: [Events.onCreate, Events.onChange],
      }),
    ],
  };

  const server = new Server(configuration);
  server.configuration.port = port;
  return server;
}
