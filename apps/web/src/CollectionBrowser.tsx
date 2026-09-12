import { useEffect, useState, type JSX } from "react";
import {
  getCollection,
  getCollections,
  listDocuments,
  openDocument,
  type CollectionEntry,
  type CollectionSummary,
  type DocumentSummary,
} from "./api.ts";

export interface CollectionBrowserProps {
  onOpen: (documentId: string) => void;
}

interface Selection {
  collection: CollectionSummary;
  entries: CollectionEntry[];
  drafts: DocumentSummary[];
}

/** Browse the collections found in the Astro project and open a file to edit. */
export function CollectionBrowser({
  onOpen,
}: CollectionBrowserProps): JSX.Element {
  const [collections, setCollections] = useState<CollectionSummary[]>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>();
  const [error, setError] = useState<string>();
  const [newPath, setNewPath] = useState("");

  useEffect(() => {
    getCollections()
      .then((project) => {
        setCollections(project.collections);
        setWarnings(project.warnings);
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  async function select(collection: CollectionSummary): Promise<void> {
    setError(undefined);
    try {
      const [detail, drafts] = await Promise.all([
        getCollection(collection.name),
        listDocuments({ collection: collection.name }),
      ]);
      setSelection({
        collection,
        entries: [...detail.entries],
        drafts: drafts.documents,
      });
      setNewPath(
        `${collection.contentPath ?? "src/content"}/new-post.${collection.formats[0] ?? "md"}`,
      );
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function open(collection: string, path: string): Promise<void> {
    setError(undefined);
    try {
      const { document } = await openDocument(collection, path);
      onOpen(document.id);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  if (error !== undefined && collections === undefined) {
    return <p role="alert">{error}</p>;
  }
  if (collections === undefined)
    return <p className="hint">Loading collections…</p>;

  return (
    <section className="card">
      <div className="card-header">
        <h2>Content</h2>
        {selection && (
          <button type="button" onClick={() => setSelection(undefined)}>
            ← All collections
          </button>
        )}
      </div>

      {warnings.map((warning) => (
        <p className="hint" key={warning}>
          {warning}
        </p>
      ))}
      {error !== undefined && <p role="alert">{error}</p>}

      {selection === undefined ? (
        <ul className="list">
          {collections.map((collection) => (
            <li key={collection.name}>
              <button type="button" onClick={() => void select(collection)}>
                <strong>{collection.name}</strong>
                <span className="hint">
                  {collection.contentPath ?? "custom loader"} ·{" "}
                  {collection.formats.join(", ") || "—"} ·{" "}
                  {collection.entryCount ?? "?"} entries ·{" "}
                  {collection.schema.inferred
                    ? `${collection.schema.fields.length} fields`
                    : "schema not inferred"}
                </span>
              </button>
            </li>
          ))}
          {collections.length === 0 && (
            <li className="hint">No collections found.</li>
          )}
        </ul>
      ) : (
        <EntryList
          selection={selection}
          newPath={newPath}
          onNewPath={setNewPath}
          onOpen={open}
        />
      )}
    </section>
  );
}

interface EntryListProps {
  selection: Selection;
  newPath: string;
  onNewPath: (path: string) => void;
  onOpen: (collection: string, path: string) => Promise<void>;
}

function EntryList({
  selection,
  newPath,
  onNewPath,
  onOpen,
}: EntryListProps): JSX.Element {
  const { collection, entries, drafts } = selection;
  const draftByPath = new Map(drafts.map((draft) => [draft.path, draft]));
  const paths = [
    ...new Set([...entries.map((entry) => entry.path), ...draftByPath.keys()]),
  ].sort();

  return (
    <>
      <p className="hint">
        {collection.name} · {collection.contentPath}
      </p>
      <ul className="list">
        {paths.map((path) => {
          const draft = draftByPath.get(path);
          return (
            <li key={path}>
              <button
                type="button"
                onClick={() => void onOpen(collection.name, path)}
              >
                <strong>{path.split("/").pop()}</strong>
                <span className="hint">
                  {path}
                  {draft ? ` · draft, revision ${draft.revision}` : ""}
                </span>
              </button>
            </li>
          );
        })}
        {paths.length === 0 && <li className="hint">No entries yet.</li>}
      </ul>

      <form
        className="new-entry"
        onSubmit={(event) => {
          event.preventDefault();
          void onOpen(collection.name, newPath);
        }}
      >
        <label>
          New file
          <input
            value={newPath}
            onChange={(event) => onNewPath(event.target.value)}
          />
        </label>
        <button type="submit">Create draft</button>
      </form>
    </>
  );
}
