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

## Frontmatter

Frontmatter renders as controls generated from the collection's schema: a
checkbox for a boolean, a date picker for a date, a select for an enum, a tag
input for an array of strings, a number input for a number, and a text
input (a textarea once a value spans lines) for a plain string. A field
whose type has no control yet — `object`, `image`, `reference`, `union`,
`literal`, `unknown`, or an array of anything but strings — gets a raw YAML
box for that one field, labelled with why. Keys in the file the schema does
not mention appear, still editable, in an "Other fields" box.

An edit writes back through a YAML document rather than a parse-and-restringify
round trip, so comments, key order, and quoting on every key nobody touched
survive a save. Whitespace right before an inline comment does not — that is
the one thing this cannot preserve.

The whole thing falls back to today's raw YAML box when the collection's
schema cannot be inferred, the collection request fails, or the file's
frontmatter is not valid YAML at all
([ADR-0007](docs/adr/0007-frontmatter-schema-inference.md),
[ADR-0022](docs/adr/0022-frontmatter-controls.md)).

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
still referenced. Storage credentials never reach the browser
([ADR-0017](docs/adr/0017-media-storage.md)).

Unused files are deleted automatically, `MEDIA_GC_GRACE_DAYS` (default 7,
minimum 1) after they were last seen with no reference, and only once no
draft, no open CMS pull request, and not the base branch refers to them any
more. A sweep runs every `MEDIA_GC_INTERVAL_HOURS` (default 6); set it to
`0` to switch collection off. Collection never starts unless media storage
is configured. A sweep that cannot establish what is referenced — GitHub
unreachable, no content collections found, the base branch missing — deletes
nothing and logs why.

Only `.md` and `.mdx` files under each collection's content path are
scanned for references. A media URL that only appears somewhere else — an
`.astro` component, for instance — is never seen by the scanner and can
eventually be collected even while still in use there. Know this before
turning collection on
([ADR-0021](docs/adr/0021-media-collection.md)).

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

## MCP

Set `MCP_TOKEN` and the CMS also answers as an MCP server at
`POST /api/mcp`, so a model can do what a person can do in the browser —
and no more. Leave it unset and that route answers 404.

```sh
MCP_TOKEN=$(openssl rand -hex 32)
```

Clients authenticate with that token as a bearer token. It is deliberately
separate from `CMS_PASSWORD`: the browser uses the password and a session
cookie, an MCP client uses this token, and neither grants the other.

```sh
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The tools cover the same ground as the web UI: read the project and its
collections, list, search, create, update and delete drafts, list, upload and
delete media, then publish — which opens or updates the same pull request the
browser would, and stops on drift the same way.

`upload_media` takes a **public URL**, not file bytes: the server fetches the
image and stores it, then returns the public URL to embed in content. It
refuses anything but http/https, refuses addresses that are not publicly
routable, and does not follow redirects
([ADR-0020](docs/adr/0020-mcp-interface.md)).

Changes made through MCP are attributed to a collaborator named **MCP**, so
they read like anyone else's in the history.

## Known limitations

- The login rate limit (10 failed attempts per 15 minutes) is keyed by the TCP
  peer address. Behind a reverse proxy every client shares one address, so
  enough failed attempts from anyone block everyone until the window ends.
- ESLint parses with TypeScript 6.0 while the project type-checks with
  TypeScript 7, because `typescript-eslint` does not support 7 yet
  ([ADR-0012](docs/adr/0012-pnpm-workspaces-and-tooling.md)).
