# Media Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse every stored file, find the ones nothing references any more, see where a file is used, and delete one at a time.

**Architecture:** One new server capability — `references(id)` on the media service, exposed as a REST route and an MCP tool so both interfaces answer the same question. The browser gets three API functions and two components: a grid with an unused filter, and a detail panel that shows usage and owns the delete button.

**Tech Stack:** better-sqlite3 13 (plain SQL, no ORM), Hono 4.13, `@modelcontextprotocol/server` 2.0.0, React 19, Vite 8, Vitest 5, Node 24 type stripping.

**Spec:** `docs/superpowers/specs/2026-09-16-media-library-design.md`

## Global Constraints

- **The browser never receives storage credentials.** It gets public URLs only.
- **Never delete media without proving it is unused.** A failed references request leaves delete disabled.
- **UI and MCP go through the same application service.** No query logic in a route.
- **No uploading from the library page**, and **no thumbnail generation** — both deliberate, both argued in the spec.
- **Page size is 24.** Images use `loading="lazy"` and explicit `width`/`height` from the stored dimensions.
- **Interfaces, not type aliases,** for object shapes (ESLint `consistent-type-definitions`).
- **Explicit return types** on exported functions (ESLint `explicit-module-boundary-types`).
- **Relative imports carry the `.ts`/`.tsx` extension.** Only erasable TypeScript syntax — no enums, no parameter properties, no namespaces.
- **Every task ends green:** `pnpm check` must pass before committing.
- Commit messages: `<type>: <description>` — subject line, blank line, then body. Nothing else on the subject line.

**On component tests:** this repository has no React testing library, and no component is unit-tested today. Tasks 1–3 hold every piece of logic worth testing. Task 4's components stay thin and are verified in a real browser in Task 6. Do not add a testing library.

---

### Task 1: Where a file is used, in SQL

**Files:**

- Modify: `apps/server/src/db/media-repository.ts`
- Test: `apps/server/src/db/media-repository.test.ts`

**Interfaces:**

- Consumes: the existing `media_references(media_id, document_id)` and `media_git_references(media_id, ref, path)` tables, and `documents(id, collection, path)`.
- Produces:
  - `interface DraftReference { readonly documentId: string; readonly collection: string; readonly path: string }`
  - `interface RepoReference { readonly ref: string; readonly path: string }`
  - `interface MediaUsage { readonly drafts: DraftReference[]; readonly git: RepoReference[] }`
  - `findReferences(mediaId: string): MediaUsage` on `MediaRepository`

**Note on naming:** this file already exports a `GitReference`, which is
`{ mediaId, path }` — the shape the scanner _writes_. `RepoReference` is the
shape a reader _gets back_, without the id they already have. They are
genuinely different types; do not merge them, and do not reuse the name.

- [ ] **Step 1: Write the failing test**

The file has one `describe("media repository git references")` block holding
`db`, `media`, an `add(id)` helper that inserts a media row, and a
`beforeEach` that opens an in-memory database. Documents are seeded with
`createDocumentRepository(db)` — see the existing test "counts drafts and git
refs together" for the exact insert shape.

Append inside that same `describe`, using those fixtures (this is verbatim —
`add`, `media` and `db` all already exist):

```ts
  describe("findReferences", () => {
    function addDocument(): void {
      createDocumentRepository(db).insert({
        id: "d1",
        collection: "blog",
        path: "src/content/blog/hello.md",
        format: "md",
        slug: "hello",
        source: "# Hi\n",
        createdBy: null,
        createdAt: 1000,
        baseCommitSha: null,
      });
    }

    it("reports the drafts and the git refs that use a file", () => {
      add("m1");
      addDocument();
      media.setReferences("d1", ["m1"]);
      media.setGitReferences("main", [
        { mediaId: "m1", path: "src/content/blog/other.md" },
      ]);

      expect(media.findReferences("m1")).toEqual({
        drafts: [
          {
            documentId: "d1",
            collection: "blog",
            path: "src/content/blog/hello.md",
          },
        ],
        git: [{ ref: "main", path: "src/content/blog/other.md" }],
      });
    });

    it("returns two empty lists for a file nothing uses", () => {
      add("m1");

      expect(media.findReferences("m1")).toEqual({ drafts: [], git: [] });
    });

    it("returns two empty lists for a file that does not exist", () => {
      expect(media.findReferences("nope")).toEqual({ drafts: [], git: [] });
    });

    it("forgets a draft reference once the document is deleted", () => {
      add("m1");
      addDocument();
      media.setReferences("d1", ["m1"]);

      db.prepare("DELETE FROM documents WHERE id = ?").run("d1");

      expect(media.findReferences("m1").drafts).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @astro-cms/server exec vitest run src/db/media-repository.test.ts`
Expected: FAIL — `repository.findReferences is not a function`.

- [ ] **Step 3: Add the types and the method**

In `apps/server/src/db/media-repository.ts`, beside the existing `GitReference` interface:

```ts
/** A draft that uses a media file, named the way a person reads it. */
export interface DraftReference {
  readonly documentId: string;
  readonly collection: string;
  readonly path: string;
}

/** A place in the repository that uses a media file, as a reader gets it. */
export interface RepoReference {
  readonly ref: string;
  readonly path: string;
}

/** Everywhere one media file is currently used (ADR-0021's two sources). */
export interface MediaUsage {
  readonly drafts: DraftReference[];
  readonly git: RepoReference[];
}
```

Add to the `MediaRepository` interface, after `findByObjectKeys`:

```ts
  /** Where one file is used: drafts by path, git references by ref and path. */
  findReferences(mediaId: string): MediaUsage;
```

And implement it in the returned object, beside `list`:

```ts
    findReferences(mediaId) {
      const drafts = db
        .prepare<[string], { documentId: string; collection: string; path: string }>(
          `SELECT d.id AS documentId, d.collection AS collection, d.path AS path
             FROM media_references r
             JOIN documents d ON d.id = r.document_id
            WHERE r.media_id = ?
            ORDER BY d.path`,
        )
        .all(mediaId);
      const git = db
        .prepare<[string], { ref: string; path: string }>(
          `SELECT ref, path FROM media_git_references
            WHERE media_id = ?
            ORDER BY ref, path`,
        )
        .all(mediaId);
      return { drafts, git };
    },
```

Both queries are ordered so the answer is stable between calls — an unordered list that reshuffles makes a UI flicker and a test flaky.

- [ ] **Step 4: Run the test and the whole check**

Run: `pnpm --filter @astro-cms/server exec vitest run src/db/media-repository.test.ts`
Expected: PASS (4 new tests).
Then `pnpm check`. Fix formatting with `pnpm exec prettier --write <files>` if needed.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/media-repository.ts apps/server/src/db/media-repository.test.ts
git commit -m "feat: query where a media file is used"
```

---

### Task 2: The service method and the route

**Files:**

- Modify: `apps/server/src/services/media.ts`
- Modify: `apps/server/src/routes/media.ts`
- Test: `apps/server/src/routes/media.test.ts`

**Interfaces:**

- Consumes: `findReferences(mediaId: string): MediaUsage` and the `MediaUsage`/`DraftReference` types from Task 1.
- Produces:
  - `references(id: string): MediaUsage` on `MediaService`
  - `GET /api/media/:id/references` → `{ references: MediaUsage }`

- [ ] **Step 1: Write the failing test**

Open `apps/server/src/routes/media.test.ts` and follow its existing setup — how it builds the app, signs in, and uploads a file. Append a test in that style:

```ts
it("reports where a media file is used", async () => {
  const { app, cookie, mediaId } = await uploadOne();

  const response = await app.request(`/api/media/${mediaId}/references`, {
    headers: { cookie },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    references: { drafts: [], git: [] },
  });
});

it("refuses references for a media file that does not exist", async () => {
  const { app, cookie } = await uploadOne();

  const response = await app.request("/api/media/missing/references", {
    headers: { cookie },
  });

  expect(response.status).toBe(404);
});
```

Use whatever the file's existing helper is called instead of `uploadOne` if it differs; keep the assertions identical.

The file already has a test for media routes being unavailable when storage is unconfigured — the `media_disabled` middleware covers every route under `/api/media`, including this one, so it needs no separate case here. Check that such a test exists; if it does not, add one for this route.

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @astro-cms/server exec vitest run src/routes/media.test.ts`
Expected: FAIL — the first test gets 404 because the route does not exist.

- [ ] **Step 3: Add the service method**

In `apps/server/src/services/media.ts`, extend the imports from the repository:

```ts
import type {
  MediaRecord,
  MediaRepository,
  MediaUsage,
} from "../db/media-repository.ts";
```

Add to the `MediaService` interface, after `get`:

```ts
  /** Where a file is used. Throws `not_found` when there is no such file. */
  references(id: string): MediaUsage;
```

And implement it in the returned object, after `get`:

```ts
    references(id) {
      // `find` throws not_found, so a bad id cannot come back as "unused" —
      // which is the one answer that would make deletion look safe.
      find(id);
      return repository.findReferences(id);
    },
```

The `find(id)` call is the point of the method: without it an unknown id would return two empty lists, and empty lists are exactly what the UI treats as "safe to delete".

- [ ] **Step 4: Add the route**

In `apps/server/src/routes/media.ts`, between the existing `routes.get("/:id", …)` and `routes.delete("/:id", …)`:

```ts
routes.get("/:id/references", (c) =>
  c.json({ references: media.references(c.req.param("id")) }),
);
```

It needs no `withName`: the existing `GET` routes do not require a named collaborator, and this reads the same data they do.

- [ ] **Step 5: Run the test and the whole check**

Run: `pnpm --filter @astro-cms/server exec vitest run src/routes/media.test.ts`
Expected: PASS.
Then `pnpm check`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/media.ts apps/server/src/routes/media.ts apps/server/src/routes/media.test.ts
git commit -m "feat: serve where a media file is used"
```

---

### Task 3: The MCP tool, and a stale description

**Files:**

- Modify: `apps/server/src/mcp/tools.ts`
- Test: `apps/server/src/mcp/tools.test.ts`

**Interfaces:**

- Consumes: `references(id: string): MediaUsage` from Task 2.
- Produces: the MCP tool `get_media_references`.

- [ ] **Step 1: Write the failing test**

Open `apps/server/src/mcp/tools.test.ts` and find how it calls an existing media tool (`get_media` or `list_media`) — how it builds the server, how it invokes a tool by name, and how it reads the result's text. Append these two tests using **that** harness; adapt the call and the result-reading to match it exactly, and keep the assertions as written:

```ts
it("reports where a media file is used", async () => {
  const { call, mediaId } = await setupWithMedia();

  const result = await call("get_media_references", { id: mediaId });

  expect(result.isError).toBeFalsy();
  expect(JSON.parse(textOf(result))).toEqual({ drafts: [], git: [] });
});

it("refuses references for a media file that does not exist", async () => {
  const { call } = await setupWithMedia();

  const result = await call("get_media_references", { id: "missing" });

  expect(result.isError).toBe(true);
});
```

`setupWithMedia`, `call` and `textOf` stand in for whatever the file already uses. Do not introduce a second harness beside the one it has.

The second test is the important one: an unknown id must be an error, not two empty lists. Empty lists are what the UI reads as "safe to delete".

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @astro-cms/server exec vitest run src/mcp/tools.test.ts`
Expected: FAIL — no tool named `get_media_references`.

- [ ] **Step 3: Register the tool**

In `apps/server/src/mcp/tools.ts`, immediately after the existing `get_media` registration:

```ts
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
```

`run` already turns a thrown `MediaError` into an error result, so an unknown id needs no special handling here.

**Note on the `registerTool` overloads (ADR-0020):** if typecheck complains about `ZodRawShape`, the cause is inference falling through to a deprecated overload, not your schema. The shape above matches the neighbouring tools exactly — keep it.

- [ ] **Step 4: Fix the stale `list_media` description**

Still in `apps/server/src/mcp/tools.ts`, the `list_media` description says `unused` lists files "no draft references". Since ADR-0021 the filter counts git references too. Replace that sentence so it says `unused` lists only files that nothing references — no draft and no branch.

- [ ] **Step 5: Run the test and the whole check**

Run: `pnpm --filter @astro-cms/server exec vitest run src/mcp/tools.test.ts`
Expected: PASS.
Then `pnpm check`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/mcp/tools.ts apps/server/src/mcp/tools.test.ts
git commit -m "feat: expose media references over MCP"
```

---

### Task 4: The browser's media API

**Files:**

- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.test.ts`

**Interfaces:**

- Consumes: `GET /api/media?unused=&limit=&offset=`, `GET /api/media/:id/references`, `DELETE /api/media/:id`, and the existing `MediaItem` interface at `apps/web/src/api.ts:223`.
- Produces:
  - `interface DraftReference { documentId: string; collection: string; path: string }`
  - `interface RepoReference { ref: string; path: string }`
  - `interface MediaUsage { drafts: DraftReference[]; git: RepoReference[] }`
  - `listMedia(options?: { unused?: boolean; limit?: number; offset?: number }): Promise<{ media: MediaItem[] }>`
  - `getMediaReferences(id: string): Promise<{ references: MediaUsage }>`
  - `deleteMedia(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

The file already has two helpers at the top: `mockFetch(status, body)`, which stubs `fetch` and returns the mock, and `lastRequest(fetchMock)`, which returns `{ path, init }` for the most recent call. Use those. Extend the existing import from `./api.ts` with `listMedia`, `getMediaReferences` and `deleteMedia`, then append:

```ts
describe("media", () => {
  it("asks for one page of unused media", async () => {
    const fetchMock = mockFetch(200, { media: [] });

    await listMedia({ unused: true, limit: 24, offset: 24 });

    expect(lastRequest(fetchMock).path).toBe(
      "/api/media?unused=true&limit=24&offset=24",
    );
  });

  it("sends no query string when nothing is filtered", async () => {
    const fetchMock = mockFetch(200, { media: [] });

    await listMedia();

    expect(lastRequest(fetchMock).path).toBe("/api/media");
  });

  it("omits the filter rather than sending unused=false", async () => {
    const fetchMock = mockFetch(200, { media: [] });

    await listMedia({ unused: false, limit: 24 });

    expect(lastRequest(fetchMock).path).toBe("/api/media?limit=24");
  });

  it("asks where one file is used", async () => {
    const fetchMock = mockFetch(200, {
      references: { drafts: [], git: [] },
    });

    await getMediaReferences("m1");

    expect(lastRequest(fetchMock).path).toBe("/api/media/m1/references");
  });

  it("deletes one file", async () => {
    const fetchMock = mockFetch(204);

    await deleteMedia("m1");

    const { path, init } = lastRequest(fetchMock);
    expect(path).toBe("/api/media/m1");
    expect(init).toMatchObject({ method: "DELETE" });
  });
});
```

The third test is the one that matters most: `unused=false` is a different filter to the server than no filter at all, so emitting it would silently change what the page shows.

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @astro-cms/web exec vitest run src/api.test.ts`
Expected: FAIL — `listMedia is not a function`.

- [ ] **Step 3: Write the functions**

In `apps/web/src/api.ts`, after the existing `uploadMedia`:

```ts
export interface DraftReference {
  documentId: string;
  collection: string;
  path: string;
}

export interface RepoReference {
  ref: string;
  path: string;
}

export interface MediaUsage {
  drafts: DraftReference[];
  git: RepoReference[];
}

export interface ListMediaOptions {
  /** Only files nothing references — no draft, no branch. */
  unused?: boolean;
  limit?: number;
  offset?: number;
}

export function listMedia(
  options: ListMediaOptions = {},
): Promise<{ media: MediaItem[] }> {
  const query = new URLSearchParams();
  // Only `unused=true` means anything to the server; omit it otherwise
  // rather than sending `unused=false`, which reads as a different filter.
  if (options.unused === true) query.set("unused", "true");
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  // `toString()`, not `.size`: the latter is newer than this project's DOM lib.
  const suffix = query.toString();
  return request(`/api/media${suffix === "" ? "" : `?${suffix}`}`);
}

export function getMediaReferences(
  id: string,
): Promise<{ references: MediaUsage }> {
  return request(`/api/media/${encodeURIComponent(id)}/references`);
}

export function deleteMedia(id: string): Promise<void> {
  return request(`/api/media/${encodeURIComponent(id)}`, { method: "DELETE" });
}
```

- [ ] **Step 4: Run the test and the whole check**

Run: `pnpm --filter @astro-cms/web exec vitest run src/api.test.ts`
Expected: PASS.
Then `pnpm check`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat: browser client for listing and deleting media"
```

---

### Task 5: The library page

Thin presentation over Task 4. No unit tests — this repository has no React
testing library and no component is tested today; Task 6 verifies these in a
real browser.

**Files:**

- Create: `apps/web/src/media/MediaLibrary.tsx`
- Create: `apps/web/src/media/MediaDetail.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**

- Consumes: `listMedia`, `getMediaReferences`, `deleteMedia`, `MediaItem`, `MediaUsage` (Task 4).
- Produces: `MediaLibrary` — `(props: { onClose: () => void }) => JSX.Element`.

- [ ] **Step 1: Write the detail panel**

Create `apps/web/src/media/MediaDetail.tsx`:

```tsx
import { useEffect, useState, type JSX } from "react";
import {
  deleteMedia,
  getMediaReferences,
  type MediaItem,
  type MediaUsage,
} from "../api.ts";

export interface MediaDetailProps {
  item: MediaItem;
  /** Called after the file is gone, so the grid can drop it. */
  onDeleted: (id: string) => void;
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One file: what it is, where it is used, and — only when nothing uses it —
 * the button that removes it
 * (docs/superpowers/specs/2026-09-16-media-library-design.md).
 */
export function MediaDetail({
  item,
  onDeleted,
}: MediaDetailProps): JSX.Element {
  const [usage, setUsage] = useState<MediaUsage>();
  const [usageError, setUsageError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  // Bumped to re-read usage after a delete the server refused: the refusal
  // means something started using the file since this panel last looked.
  const [usageVersion, setUsageVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setUsage(undefined);
    setUsageError(undefined);
    getMediaReferences(item.id)
      .then(({ references }) => {
        if (!cancelled) setUsage(references);
      })
      .catch((caught: Error) => {
        if (!cancelled) setUsageError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, usageVersion]);

  const used = usage === undefined ? 0 : usage.drafts.length + usage.git.length;
  // Proving a file unused is the precondition for deleting it, so a usage
  // request that failed — or has not answered yet — keeps the button off.
  const deletable = usage !== undefined && used === 0;

  async function remove(): Promise<void> {
    setDeleting(true);
    setError(undefined);
    try {
      await deleteMedia(item.id);
      onDeleted(item.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed.");
      setDeleting(false);
      // Whatever the server knows, this panel does not. Re-read the usage
      // so the list below explains the refusal instead of contradicting it.
      setUsageVersion((count) => count + 1);
    }
  }

  return (
    <aside className="media-detail">
      <img src={item.url} alt={item.filename} />
      <h2>{item.filename}</h2>
      <dl>
        <dt>Size</dt>
        <dd>{readableSize(item.size)}</dd>
        <dt>Dimensions</dt>
        <dd>
          {item.width !== null && item.height !== null
            ? `${String(item.width)} × ${String(item.height)}`
            : "unknown"}
        </dd>
        <dt>Uploaded</dt>
        <dd>
          {new Date(item.uploadedAt).toLocaleDateString()}
          {item.uploadedBy ? ` by ${item.uploadedBy.name}` : ""}
        </dd>
      </dl>

      <h3>Used in</h3>
      {usageError !== undefined && (
        <p className="hint" role="alert">
          Could not read where this is used: {usageError}
        </p>
      )}
      {usage === undefined && usageError === undefined && (
        <p className="hint">Checking…</p>
      )}
      {usage !== undefined && used === 0 && (
        <p className="hint">
          Nothing uses this file
          {item.unusedSince !== null
            ? `, since ${new Date(item.unusedSince).toLocaleDateString()}`
            : ""}
          . It is collected automatically after the grace period.
        </p>
      )}
      {usage !== undefined && used > 0 && (
        <ul className="media-usage">
          {usage.drafts.map((draft) => (
            <li key={`d-${draft.documentId}`}>
              {draft.path} <span className="hint">draft</span>
            </li>
          ))}
          {usage.git.map((reference) => (
            <li key={`g-${reference.ref}-${reference.path}`}>
              {reference.path} <span className="hint">{reference.ref}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void remove()}
        disabled={!deletable || deleting}
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
      {error !== undefined && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Write the grid**

Create `apps/web/src/media/MediaLibrary.tsx`:

```tsx
import { useCallback, useEffect, useState, type JSX } from "react";
import { listMedia, type MediaItem } from "../api.ts";
import { MediaDetail } from "./MediaDetail.tsx";

/** Matches the spec: small enough that a page of originals stays reasonable. */
const PAGE_SIZE = 24;

export interface MediaLibraryProps {
  onClose: () => void;
}

/**
 * Everything the bucket holds, newest first, with a filter for files nothing
 * references (docs/superpowers/specs/2026-09-16-media-library-design.md).
 *
 * There is no upload here on purpose: collection deletes anything that goes
 * unreferenced past the grace period, so a file uploaded "for later" would
 * disappear on its own.
 */
export function MediaLibrary({ onClose }: MediaLibraryProps): JSX.Element {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selected, setSelected] = useState<MediaItem>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const load = useCallback((offset: number, unused: boolean) => {
    setLoading(true);
    setError(undefined);
    listMedia({ unused, limit: PAGE_SIZE, offset })
      .then(({ media }) => {
        setItems((previous) =>
          offset === 0 ? media : [...previous, ...media],
        );
        setDone(media.length < PAGE_SIZE);
        setLoading(false);
      })
      .catch((caught: Error) => {
        setError(caught.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    setSelected(undefined);
    load(0, unusedOnly);
  }, [load, unusedOnly]);

  return (
    <main className="content media-library">
      <header className="editor-header">
        <button type="button" onClick={onClose}>
          ← Back
        </button>
        <strong>Media</strong>
        <span className="spacer" />
        <label>
          <input
            type="checkbox"
            checked={unusedOnly}
            onChange={(event) => setUnusedOnly(event.target.checked)}
          />{" "}
          Unused only
        </label>
      </header>

      {error !== undefined && (
        <p className="hint" role="alert">
          {error}{" "}
          <button type="button" onClick={() => load(0, unusedOnly)}>
            Retry
          </button>
        </p>
      )}

      <div className="media-layout">
        <ul className="media-grid">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(item)}
                aria-current={selected?.id === item.id}
              >
                <img
                  src={item.url}
                  alt={item.filename}
                  loading="lazy"
                  width={item.width ?? undefined}
                  height={item.height ?? undefined}
                />
                <span className="hint">{item.filename}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && !loading && (
            <li className="hint">
              {unusedOnly ? "Nothing is unused." : "No media yet."}
            </li>
          )}
        </ul>

        {selected !== undefined && (
          <MediaDetail
            item={selected}
            onDeleted={(id) => {
              setItems((previous) => previous.filter((it) => it.id !== id));
              setSelected(undefined);
            }}
          />
        )}
      </div>

      {!done && items.length > 0 && (
        <button
          type="button"
          onClick={() => load(items.length, unusedOnly)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Wire it into the app**

In `apps/web/src/App.tsx`, extend the `View` union at line 16:

```tsx
type View =
  { name: "browse" } | { name: "edit"; documentId: string } | { name: "media" };
```

Import the page:

```tsx
import { MediaLibrary } from "./media/MediaLibrary.tsx";
```

Add a branch that renders `<MediaLibrary onClose={() => onView({ name: "browse" })} />` when `view.name === "media"`, following exactly how the existing `edit` branch is written. Then add a "Media" button to the browse view's header that calls `onView({ name: "media" })`.

- [ ] **Step 4: Add the styles**

Append to `apps/web/src/styles.css`, following the conventions already there — `rem` units, and `color-mix(in srgb, currentColor N%, transparent)` for borders as `.frontmatter` does:

```css
.media-layout {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.media-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
  gap: 0.75rem;
}

.media-grid button {
  display: grid;
  gap: 0.25rem;
  width: 100%;
  padding: 0;
  border: 1px solid transparent;
  background: none;
  color: inherit;
  text-align: left;
}

.media-grid button[aria-current="true"] {
  border-color: currentColor;
}

.media-grid img {
  width: 100%;
  height: 8rem;
  object-fit: cover;
  border-radius: 0.25rem;
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.media-grid .hint {
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.media-detail {
  width: min(22rem, 40%);
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 0.375rem;
  padding: 0.75rem;
}

.media-detail img {
  width: 100%;
  max-height: 14rem;
  object-fit: contain;
}

.media-detail h2 {
  font-size: 1rem;
  overflow-wrap: anywhere;
}

.media-usage {
  padding-left: 1rem;
  overflow-wrap: anywhere;
}
```

The `width`/`height` attributes on each grid image come from the record's stored dimensions and exist to stop the grid reflowing as images arrive; the CSS above overrides the rendered size while keeping the aspect ratio the attributes imply.

- [ ] **Step 5: Run the whole check**

Run: `pnpm check`. There are no new tests here; typecheck, ESLint (including the React Compiler rules) and Prettier are the gate. Fix formatting with `pnpm exec prettier --write <files>` if needed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/media apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: browse and delete media in the web interface"
```

---

### Task 6: Documentation and a real bucket

**Files:**

- Create: `docs/adr/0023-media-library.md`
- Modify: `docs/adr/README.md`, `README.md`

- [ ] **Step 1: Write ADR-0023**

Follow the house style of the existing ADRs (`# ADR-NNNN: Title`, then
**Date**/**Status**/**Deciders**, then Context, Decision, Alternatives
Considered with Pros/Cons/Why not, Consequences with Positive/Negative/Risks).
Read `docs/adr/0021-media-collection.md` first — it is the one this builds on,
and the closest model for tone.

Record:

- References are served from a service method, not a route query, so MCP's `get_media_references` and the page answer the same question.
- An unknown id throws rather than returning two empty lists, because empty lists are what the UI reads as "safe to delete".
- Delete stays disabled while usage is unknown or failed to load.
- No uploading from the library, because collection would delete anything uploaded and not placed within `MEDIA_GC_GRACE_DAYS`. Making it safe would need an exemption for "uploaded but not yet placed" — a feature, not a button.
- No thumbnails: `image-size` only reads dimensions, so generating them needs a native image library this repository keeps out, plus a second object per record and collection changes to delete both. Originals are lazily loaded instead, and the failure mode is a bucket of large originals making the first page load heavy.
- Alternatives rejected: a bulk "delete all unused" button (collection already does this safely on a timer; the button mostly buys a faster mistake); exposing the reference count only (a count of zero permits deletion but says nothing about whether the file would be missed).

- [ ] **Step 2: Add the index row**

Append to `docs/adr/README.md`, matching the existing column alignment:

```markdown
| [0023](0023-media-library.md) | Media library: references from a shared service, no upload, no thumbnails | accepted | 2026-09-16 |
```

- [ ] **Step 3: Update the README**

Add media to the README's description of the web interface: browsing everything stored, filtering to files nothing references, seeing which drafts and branches use a file, and deleting one that nothing uses. Say plainly that images are added by pasting or dropping them into a post rather than uploaded here, and why — collection removes anything that stays unreferenced.

- [ ] **Step 4: Run the whole check and commit**

```bash
pnpm check
git add docs README.md
git commit -m "docs: record how the media library works"
```

- [ ] **Step 5: Verify against a real bucket**

Start MinIO and the servers. Borrow the real `GITHUB_*` and `S3_*` values from `.env` without modifying it, and use ports 3100 and 5174 — the user's own processes hold 3000 and 5173.

```bash
cd /Users/reduanmasud/Documents/Projects/miscellaneous/astro-cms
docker run -d --name fm-minio -p 9100:9000 -p 9101:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio:latest server /data --console-address ":9101"
set -a; . ./.env; set +a
PORT=3100 DATA_DIR=/tmp/media-probe CMS_PASSWORD=probe-password \
SESSION_SECRET=probe-secret-that-is-long-enough-0123456789 \
node apps/server/src/index.ts &
API_PROXY_TARGET=http://localhost:3100 pnpm --filter @astro-cms/web exec vite --port 5174 --strictPort &
```

Then, in a browser:

1. Paste an image into a post so a file exists with a draft reference.
2. Open Media. Confirm the image appears, and that its detail panel names the post that uses it and shows Delete disabled.
3. Remove the image from the post, save, and reload Media. With "Unused only" ticked, confirm the file now appears there.
4. Delete it. Confirm it disappears from the grid and that `GET /api/media/<id>` returns 404.
5. Upload more than 24 images (a loop against `POST /api/media` is fine) and confirm "Load more" pages correctly and stops at the end.
6. Confirm `get_media_references` over MCP returns the same answer the panel showed for a file with a reference.

Report what rendered, what each panel said, and anything that looked wrong. Stop the servers and remove the MinIO container; leave no probe process running.

---
