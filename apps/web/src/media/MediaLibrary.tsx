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

  // Pure fetch: every setState here happens inside `.then()`/`.catch()`, not
  // synchronously in its own body. That's what lets an effect call it
  // directly — callers that want the "now loading" flag shown right away
  // (the checkbox, Retry, Load more) set `loading`/`error` themselves before
  // calling this, from their own event handler.
  const load = useCallback((offset: number, unused: boolean) => {
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

  // Mount and filter changes both start from `loading: true, error: undefined`
  // already — the initial state covers mount, and the checkbox's handler
  // sets both before flipping `unusedOnly`, in the same render as the state
  // change this effect reacts to.
  useEffect(() => {
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
            onChange={(event) => {
              setLoading(true);
              setError(undefined);
              setSelected(undefined);
              setUnusedOnly(event.target.checked);
            }}
          />{" "}
          Unused only
        </label>
      </header>

      {error !== undefined && (
        <p className="hint" role="alert">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(undefined);
              load(0, unusedOnly);
            }}
          >
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
            key={selected.id}
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
          onClick={() => {
            setLoading(true);
            setError(undefined);
            load(items.length, unusedOnly);
          }}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </main>
  );
}
