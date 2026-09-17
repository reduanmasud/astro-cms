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

  // Keyed by `item.id` in MediaLibrary, so a new selection remounts this
  // component instead of reusing it: `usage`/`usageError` start `undefined`
  // for the new file rather than briefly carrying the previous file's
  // answer. That is what keeps "delete stays disabled until usage is known"
  // true across a selection change.
  useEffect(() => {
    let cancelled = false;
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
    if (
      !window.confirm(
        `Permanently delete ${item.filename}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(undefined);
    try {
      await deleteMedia(item.id);
      onDeleted(item.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed.");
      setDeleting(false);
      // Whatever the server knows, this panel does not. Drop the stale
      // answer before re-reading: until the new one arrives, usage is
      // genuinely unknown, and unknown must mean the button stays off.
      setUsage(undefined);
      setUsageError(undefined);
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
        className="btn btn-danger"
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
