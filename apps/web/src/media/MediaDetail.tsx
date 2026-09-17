import { useEffect, useState, type JSX } from "react";
import {
  deleteMedia,
  getMediaReferences,
  type MediaItem,
  type MediaUsage,
} from "../api.ts";
import { MediaIcon } from "../Icons.tsx";

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
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  function copyPath(): void {
    navigator.clipboard.writeText(item.objectKey).then(
      () => {
        setCopied(true);
      },
      () => {
        setError("Could not copy the path to the clipboard.");
      },
    );
  }

  async function remove(): Promise<void> {
    setDeleting(true);
    setError(undefined);
    try {
      await deleteMedia(item.id);
      onDeleted(item.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed.");
      setDeleting(false);
      setConfirming(false);
      // Whatever the server knows, this panel does not. Drop the stale
      // answer before re-reading: until the new one arrives, usage is
      // genuinely unknown, and unknown must mean the button stays off.
      setUsage(undefined);
      setUsageError(undefined);
      setUsageVersion((count) => count + 1);
    }
  }

  return (
    <aside className="media-detail" aria-label="File details">
      <div className="media-detail-preview">
        {item.contentType.startsWith("image/") ? (
          <img src={item.url} alt={item.filename} />
        ) : (
          <MediaIcon />
        )}
      </div>

      <div>
        <h2 className="mono">{item.filename}</h2>
        <p className="media-detail-meta">
          {item.contentType}
          {item.width !== null && item.height !== null
            ? ` · ${String(item.width)} × ${String(item.height)}`
            : ""}
          {` · ${readableSize(item.size)}`}
        </p>
        <p className="media-detail-meta">
          Uploaded {new Date(item.uploadedAt).toLocaleDateString()}
          {item.uploadedBy ? ` by ${item.uploadedBy.name}` : ""}
        </p>
      </div>

      <div className="media-detail-field">
        <span>Path</span>
        <div className="media-path-row">
          <code>{item.objectKey}</code>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={copyPath}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div>
        <h3 className="media-detail-field-label">Used in</h3>
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
      </div>

      <div className="media-detail-divider" />

      {!confirming && (
        <div>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirming(true)}
            disabled={!deletable || deleting}
          >
            Delete
          </button>
        </div>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="media-delete-title"
          className="media-confirm"
        >
          <div className="media-confirm-heading">
            <strong id="media-delete-title">Delete {item.filename}?</strong>
            <p>
              The file is removed from the repository. Entries that link to it
              will show a broken image.
            </p>
          </div>
          <div className="media-confirm-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void remove()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete file"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error !== undefined && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
