# Astro CMS

A small, self-hosted CMS for **one Astro project in one GitHub repository**.

- GitHub is the source of truth for published Markdown/MDX.
- Drafts live in SQLite and never touch GitHub.
- Publishing opens (or updates) one pull request per content item.
- Editors collaborate live with Tiptap + Yjs + HocusPocus.
- Media goes to S3-compatible storage (Cloudflare R2, AWS S3, MinIO).
- MCP is a first-class interface to the same services as the web UI.
- Auth is one shared password plus a display name. No accounts, teams, or OAuth.

> **Status: early.** Login, GitHub repository access, Astro collection
> discovery, SQLite drafts, a Tiptap editor, and live collaboration exist.
> Publishing to GitHub, media, and MCP are not built yet.

## Documentation

- [Architecture](docs/architecture.md): how the pieces fit together, and the HTTP API.
- [Architecture decision records](docs/adr/README.md): why things are the way they are.

Read both before proposing structural changes. Changing a decision means
adding an ADR that supersedes the old one.

## Requirements

- **Node.js 24 or newer.** The server runs TypeScript directly through Node's
  built-in type stripping, so it has no build step.
- **pnpm 12.4.1.** Install it with npm:

  ```sh
  npm install --global pnpm@12.4.1
  ```

  Do not use Corepack for pnpm 12: the Corepack bundled with Node 24 cannot
  start it. If `pnpm` fails with `Cannot find module …/corepack/…/pnpm.cjs`,
  run `corepack disable pnpm` and install it with the command above.

- **Docker with Compose**, only for the containerized setup.

## Configure

```sh
cp .env.example .env
```

Set `CMS_PASSWORD` (12+ characters) and `SESSION_SECRET` (32+ characters).
`openssl rand -base64 32` produces a good secret. The browser never receives
either value.

Then connect the one GitHub repository the CMS edits:

- `GITHUB_OWNER` and `GITHUB_REPOSITORY`, e.g. `withastro` and `blog`.
- `GITHUB_BASE_BRANCH`, the branch pull requests target (default `main`).
- `GITHUB_TOKEN`: a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
  limited to that repository, with read and write access to **Contents** and
  **Pull requests**.

The server checks the token, push access, and base branch at startup, and
stops with an explanation if something is wrong.

## Develop with Docker Compose

```sh
docker compose up --build
```

Open <http://localhost:5173>. Compose also starts a HocusPocus server on
port 1234 for live editing. The containers reload when you edit files on
the host. The API is also reachable at <http://localhost:3000/api/health>.
SQLite data lives in the `cms-data` volume; `docker compose down -v` deletes it.

After changing dependencies, rebuild and refresh the containers' `node_modules`:

```sh
docker compose up --build --renew-anon-volumes
```

## Develop on your machine

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the API on <http://localhost:3000> and Vite on
<http://localhost:5173>. Use the Vite URL; it proxies `/api` to the API.
SQLite is stored in `apps/server/data/`.

## Scripts

Run from the repository root:

| Script              | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `pnpm dev`          | API (with `--watch`) and Vite dev server           |
| `pnpm typecheck`    | Type-check every package with TypeScript 7         |
| `pnpm lint`         | ESLint, including type-aware rules                 |
| `pnpm format`       | Format everything with Prettier                    |
| `pnpm format:check` | Check formatting without writing                   |
| `pnpm test`         | Run every package's Vitest suite                   |
| `pnpm check`        | typecheck, lint, format check, and tests, in order |
| `pnpm build`        | Build the frontend into `apps/web/dist`            |

Run a script in one package with `pnpm --filter @astro-cms/server test`.

## Project layout

```
apps/server/            Hono API + SQLite (@astro-cms/server)
apps/collab/            development HocusPocus server (@astro-cms/collab)
apps/web/               React + Vite frontend and editor (@astro-cms/web)
packages/markdown/      Markdown/MDX <-> editor document (@astro-cms/markdown)
tooling/eslint-config/  shared ESLint config (@astro-cms/eslint-config)
tsconfig.base.json      shared TypeScript options
docs/                   architecture and ADRs
```

See [docs/architecture.md](docs/architecture.md#repository-layout) for more.

## Contributing

- Keep it small. Prefer the simplest reliable solution. No new infrastructure
  (Redis, Postgres, queues, ORMs) without a concrete need and an ADR.
- Business rules go in `apps/server/src/services/`. Routes and MCP tools stay thin.
- New API routes require a session by default. Making one public means adding
  it to `PUBLIC_ROUTES` in `apps/server/src/app.ts`.
- Server code must be erasable TypeScript (no `enum`, no parameter
  properties), and relative imports use the `.ts` extension.
- Use `interface` for object shapes and component props; use `type` for
  unions and aliases. Exported functions declare their return types. ESLint
  enforces both.
- Put tests next to the code (`*.test.ts`) and run `pnpm check` before
  opening a PR.

## Live collaboration

Collaboration is optional. Set all four values to switch it on, or none to
have the editor save directly over the API:

| Variable                    | Used by     | Purpose                                    |
| --------------------------- | ----------- | ------------------------------------------ |
| `HOCUSPOCUS_PUBLIC_URL`     | browser     | WebSocket URL clients connect to           |
| `HOCUSPOCUS_INTERNAL_URL`   | server, MCP | the same server from inside the network    |
| `HOCUSPOCUS_JWT_SECRET`     | both        | signs and verifies short-lived room tokens |
| `HOCUSPOCUS_WEBHOOK_SECRET` | both        | signs the webhook HocusPocus sends back    |

`docker compose up` runs one for development. To use your own server, it must
verify the CMS's JWT (HS256, the room is the `aud` claim) and run the standard
webhook extension against `POST /api/collab/webhook` with the `create` and
`change` events. `apps/collab/src/index.ts` is that setup in about
fifty lines. See [ADR-0016](docs/adr/0016-collaboration-service.md).

## Media

Images are stored in an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO)
with their metadata in SQLite. Set all six `S3_*` values to switch it on, or
none to leave `/api/media` returning 404. `docker compose up` starts MinIO for
development; create the bucket once at <http://localhost:9001>.

Every upload is checked by reading the file's own header, not the browser's
`Content-Type`: PNG, JPEG, GIF, WebP, and AVIF up to 10 MB. SVG is refused
because it can carry scripts. Files are stored by content hash, so uploading
the same image twice stores it once.

```sh
# upload (multipart), list, inspect, delete
curl -b cookies.txt -F file=@hero.png http://localhost:3000/api/media
curl -b cookies.txt 'http://localhost:3000/api/media?unused=true'
curl -b cookies.txt 'http://localhost:3000/api/media/<id>?verify=true'
curl -b cookies.txt -X DELETE -H 'Sec-Fetch-Site: same-origin' \
  http://localhost:3000/api/media/<id>
```

The CMS tracks which drafts use which file and refuses to delete one that is
still referenced. Nothing is deleted automatically yet; the collector in
[ADR-0008](docs/adr/0008-media-storage-and-gc.md) arrives with publishing.
Storage credentials never reach the browser
([ADR-0017](docs/adr/0017-media-storage.md)).

## Publishing

Drafting never touches GitHub. Publishing is the only thing that does.

Press **Publish** and the CMS commits the draft to `cms/<collection>/<slug>`
and opens a pull request. Publishing the same draft again adds a commit to
that same branch and pull request — never a second one. The CMS never writes
your base branch and never merges anything; you review and merge on GitHub.

If the base branch moved since the draft started, publishing stops before
writing anything and shows you the file as it stands on the base branch, with
a **Re-sync** button. Re-sync moves the draft's baseline only: it never edits
your text, and nothing is merged automatically. This is deliberately strict —
any commit to the base branch blocks publishing until you look
([ADR-0019](docs/adr/0019-publishing-through-pull-requests.md)).

Once the pull request merges, reopening the document moves it to
**published**.

> **Enable "automatically delete head branches"** on the repository settings.
> A merged pull request otherwise leaves its branch behind, and the CMS
> refuses to commit to a branch whose pull request is gone — committing there
> would reopen merged history.

## Known limitations

- The login rate limit (10 failed attempts per 15 minutes) is keyed by the TCP
  peer address. Behind a reverse proxy every client shares one address, so
  enough failed attempts from anyone block everyone until the window ends.
- ESLint parses with TypeScript 6.0 while the project type-checks with
  TypeScript 7, because `typescript-eslint` does not support 7 yet
  ([ADR-0012](docs/adr/0012-pnpm-workspaces-and-tooling.md)).
