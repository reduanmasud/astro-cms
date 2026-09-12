import { createCollabServer, DEFAULT_PORT } from "./index.ts";

/**
 * Development entry point. Compose runs this; in production you point the CMS
 * at your own HocusPocus server with the same two secrets.
 */

const required = [
  "HOCUSPOCUS_JWT_SECRET",
  "HOCUSPOCUS_WEBHOOK_SECRET",
  "CMS_WEBHOOK_URL",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const server = createCollabServer({
  jwtSecret: process.env.HOCUSPOCUS_JWT_SECRET ?? "",
  webhookSecret: process.env.HOCUSPOCUS_WEBHOOK_SECRET ?? "",
  webhookUrl: process.env.CMS_WEBHOOK_URL ?? "",
  port,
});

await server.listen(port);
console.info(`HocusPocus listening on ws://localhost:${port}`);

const shutdown = (): void => {
  void server.destroy().then(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
