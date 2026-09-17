import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { listMedia, type MediaItem } from "../api.ts";
import { listAction, type ListState } from "./listAction.ts";
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

  // Only the newest request may apply its answer, and only if it was built
  // from filter/offset values that still match reality when it lands.
  // Without the first check, a slow response can land after a faster newer
  // one — showing a list that contradicts the filter. Without the second, a
  // click that beats React's re-render (so `disabled={loading}` hasn't
  // applied yet) can fire from a stale closure — e.g. "Load more" clicked
  // just after unchecking "Unused only" — and send an offset/filter pair
  // that no longer describes what should be on screen. `listAction` decides
  // which of "replace", "append", or "discard" applies; see its tests for
  // the case that motivated it.
  const latestRequest = useRef(0);
  const applied = useRef<ListState>({ sequence: 0, count: 0, unused: false });

  // Pure fetch: every setState here happens inside `.then()`/`.catch()`, not
  // synchronously in its own body. That's what lets an effect call it
  // directly — callers that want the "now loading" flag shown right away
  // (the checkbox, Retry, Load more) set `loading`/`error` themselves before
  // calling this, from their own event handler.
  const load = useCallback((offset: number, unused: boolean) => {
    const sequence = ++latestRequest.current;
    listMedia({ unused, limit: PAGE_SIZE, offset })
      .then(({ media }) => {
        // `applied.current.unused` is the live filter, not this closure's:
        // the checkbox handler updates it the moment the filter changes, so
        // a response built from the filter's old value reads as stale here
        // even before its own replacement response has arrived.
        const action = listAction(
          { sequence, offset, unused },
          {
            sequence: latestRequest.current,
            count: applied.current.count,
            unused: applied.current.unused,
          },
        );
        if (action === "discard") return;

        applied.current = {
          sequence,
          count:
            action === "replace"
              ? media.length
              : applied.current.count + media.length,
          unused,
        };
        setItems((previous) =>
          action === "replace" ? media : [...previous, ...media],
        );
        setDone(media.length < PAGE_SIZE);
        setLoading(false);
      })
      .catch((caught: Error) => {
        const action = listAction(
          { sequence, offset, unused },
          {
            sequence: latestRequest.current,
            count: applied.current.count,
            unused: applied.current.unused,
          },
        );
        if (action === "discard") return;

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
              const unused = event.target.checked;
              // Update the live filter synchronously, ahead of the request
              // this triggers, so an in-flight response for the old filter
              // is recognised as stale the moment it lands.
              applied.current = { ...applied.current, unused };
              setLoading(true);
              setError(undefined);
              setSelected(undefined);
              setUnusedOnly(unused);
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
              // Keep the tracked count in step with what's on screen — the
              // next "Load more" sends `items.length` as its offset, and
              // `listAction` only appends when that offset matches this
              // count.
              applied.current = {
                ...applied.current,
                count: applied.current.count - 1,
              };
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
