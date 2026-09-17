import { useEffect, useState, type JSX } from "react";
import {
  getCollection,
  listDocuments,
  openDocument,
  type CollectionEntry,
  type CollectionSummary,
  type DocumentSummary,
} from "./api.ts";
import { ChevronRightIcon, PlusIcon, SearchIcon } from "./Icons.tsx";

export interface CollectionEntriesProps {
  collectionName: string;
  onOpen: (documentId: string) => void;
}

type StatusFilter = "all" | "draft" | "published";

function formatEdited(draft: DocumentSummary | undefined): string {
  if (draft === undefined) return "–";
  const who = draft.updatedBy?.name ?? "Someone";
  return `${who} · ${new Date(draft.updatedAt).toLocaleDateString()}`;
}

/** "new-post.md", or "new-post-2.md", "new-post-3.md"… past the first collision. */
function nextDraftPath(collection: CollectionSummary, existingPaths: string[]): string {
  const dir = collection.contentPath ?? "src/content";
  const ext = collection.formats[0] ?? "md";
  const taken = new Set(existingPaths);
  let candidate = `${dir}/new-post.${ext}`;
  for (let n = 2; taken.has(candidate); n += 1) {
    candidate = `${dir}/new-post-${String(n)}.${ext}`;
  }
  return candidate;
}

interface Row {
  path: string;
  draft?: DocumentSummary;
}

/**
 * The entry table for one collection: search, a draft/published filter, and
 * create-draft, replacing the old two-step "pick a collection, then pick an
 * entry" drill-down now that the sidebar owns collection choice.
 */
export function CollectionEntries({
  collectionName,
  onOpen,
}: CollectionEntriesProps): JSX.Element {
  const [collection, setCollection] = useState<CollectionSummary>();
  const [entries, setEntries] = useState<CollectionEntry[]>();
  const [drafts, setDrafts] = useState<DocumentSummary[]>([]);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    // No manual reset here: App keys this component by collectionName, so a
    // collection switch remounts it and every piece of state below already
    // starts fresh.
    Promise.all([
      getCollection(collectionName),
      listDocuments({ collection: collectionName }),
    ])
      .then(([detail, docs]) => {
        setCollection(detail.collection);
        setEntries(detail.entries);
        setDrafts(docs.documents);
      })
      .catch((caught: Error) => setError(caught.message));
  }, [collectionName]);

  async function open(path: string): Promise<void> {
    setError(undefined);
    try {
      const { document } = await openDocument(collectionName, path);
      onOpen(document.id);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  if (error !== undefined && collection === undefined) {
    return (
      <main className="content">
        <p role="alert">{error}</p>
      </main>
    );
  }
  if (collection === undefined || entries === undefined) {
    return (
      <main className="content">
        <p className="hint">Loading…</p>
      </main>
    );
  }

  const draftByPath = new Map(drafts.map((draft) => [draft.path, draft]));
  const allRows: Row[] = [
    ...new Set([...entries.map((entry) => entry.path), ...draftByPath.keys()]),
  ]
    .sort()
    .map((path) => ({ path, draft: draftByPath.get(path) }));

  const rows = allRows.filter((row) => {
    if (statusFilter === "draft" && row.draft === undefined) return false;
    if (statusFilter === "published" && row.draft !== undefined) return false;
    return row.path.toLowerCase().includes(query.toLowerCase());
  });

  const draftCount = allRows.filter((row) => row.draft !== undefined).length;
  const publishedCount = allRows.length - draftCount;

  return (
    <main className="content collection-entries">
      <div className="collection-header">
        <div>
          <h1>{collection.name}</h1>
          <p className="hint mono">{collection.contentPath}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            void open(nextDraftPath(collection, allRows.map((row) => row.path)))
          }
        >
          <PlusIcon />
          Create draft
        </button>
      </div>

      {error !== undefined && <p role="alert">{error}</p>}

      <div className="collection-toolbar">
        <div className="search-field">
          <SearchIcon />
          <input
            type="search"
            aria-label={`Search ${collection.name}`}
            placeholder={`Search ${collection.name}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div role="group" aria-label="Status" className="chip-group">
          <button
            type="button"
            className="chip"
            aria-pressed={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            All <span>{allRows.length}</span>
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={statusFilter === "draft"}
            onClick={() => setStatusFilter("draft")}
          >
            Drafts <span>{draftCount}</span>
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={statusFilter === "published"}
            onClick={() => setStatusFilter("published")}
          >
            Published <span>{publishedCount}</span>
          </button>
        </div>
      </div>

      <div className="entry-table">
        <div className="entry-row entry-row-head">
          <span>Entry</span>
          <span>Status</span>
          <span>Last edited</span>
          <span aria-hidden="true" />
        </div>
        {rows.map((row) => (
          <button
            key={row.path}
            type="button"
            className="entry-row"
            onClick={() => void open(row.path)}
          >
            <span className="entry-name">
              <strong>{row.path.split("/").pop()}</strong>
              <span className="hint mono">{row.path}</span>
            </span>
            <span className="entry-status">
              <span
                className={
                  row.draft !== undefined ? "dot dot-draft" : "dot dot-published"
                }
                aria-hidden="true"
              />
              {row.draft !== undefined
                ? `Draft · revision ${row.draft.revision}`
                : "Published"}
            </span>
            {/* Only a draft carries who/when it was last touched; a
                git-only published entry has no such record here, so this
                stays "–" rather than a guessed date (see R-17/R-38). */}
            <span className="hint">{formatEdited(row.draft)}</span>
            <ChevronRightIcon />
          </button>
        ))}
        {rows.length === 0 && allRows.length > 0 && (
          <p className="hint entry-empty">No matches.</p>
        )}
        {allRows.length === 0 && <p className="hint entry-empty">No entries yet.</p>}
      </div>
    </main>
  );
}
