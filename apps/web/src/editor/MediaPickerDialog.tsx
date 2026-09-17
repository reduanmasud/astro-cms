import { useEffect, useState, type JSX } from "react";
import { listMedia, type MediaItem } from "../api.ts";
import { CloseIcon, SearchIcon } from "../Icons.tsx";

export interface MediaPickerDialogProps {
  onSelect: (item: MediaItem) => void;
  onClose: () => void;
}

/**
 * "Image" isn't only "upload a new file" — most images a document needs
 * were probably uploaded already, for this document or another one. Reuses
 * the Media library's own tile grid styling, so a file looks the same here
 * as it does there.
 */
export function MediaPickerDialog({
  onSelect,
  onClose,
}: MediaPickerDialogProps): JSX.Element {
  const [items, setItems] = useState<MediaItem[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");

  useEffect(() => {
    listMedia({ limit: 60 })
      .then(({ media }) => setItems(media))
      .catch((caught: Error) => setError(caught.message));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const filtered =
    items?.filter((item) =>
      item.filename.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];

  return (
    <div className="media-picker-overlay">
      <div
        className="publish-review-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-picker-title"
        className="media-picker"
      >
        <header className="media-picker-header">
          <h2 id="media-picker-title">Insert from media library</h2>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="search-field media-picker-search">
          <SearchIcon />
          <input
            type="search"
            aria-label="Filter media"
            placeholder="Filter files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </div>

        {error !== undefined && (
          <p className="hint" role="alert">
            {error}
          </p>
        )}
        {items === undefined && error === undefined && (
          <p className="hint">Loading…</p>
        )}
        {items !== undefined && filtered.length === 0 && (
          <p className="hint">
            {items.length === 0
              ? "No media yet. Upload a file from the Media library first."
              : "No matches."}
          </p>
        )}

        <ul className="media-grid media-picker-grid">
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="media-tile"
                onClick={() => onSelect(item)}
              >
                <span className="media-tile-thumb">
                  <img src={item.url} alt={item.filename} loading="lazy" />
                </span>
                <span className="mono media-tile-name">{item.filename}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
