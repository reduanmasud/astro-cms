import type { MediaRepository } from "../db/media-repository.ts";
import type { MediaGitScanner } from "./media-git-scanner.ts";
import type { MediaReferenceTracker } from "./media-references.ts";
import { MediaError, type MediaService } from "./media.ts";

/**
 * Deleting media nothing uses any more (docs/adr/0008-media-storage-and-gc.md).
 *
 * A sweep recomputes every reference first — drafts, the base branch, and open
 * CMS branches — and that recompute *is* the recheck the ADR requires. If any
 * of it fails, the sweep deletes nothing: zero references from a failed scan
 * looks exactly like zero references from a real one, and deletion here has to
 * be proof, not assumption.
 */

/** Why a sweep deleted nothing at all. */
export type SweepRefusal = "storage_disabled" | "scan_failed";

export interface SweepSummary {
  readonly deleted: number;
  /** Files whose object could not be removed; their rows are kept. */
  readonly failed: number;
  /** Files that gained a reference between the recheck and the delete. */
  readonly inUse: number;
  /** Files old enough to delete when the sweep began. */
  readonly candidates: number;
  /** True when the sweep refused to delete: storage off, or a scan failed. */
  readonly skipped: boolean;
  /** Why it refused, or null when the sweep ran. */
  readonly reason: SweepRefusal | null;
  /** The error that stopped the scan, when `reason` is "scan_failed". */
  readonly error: unknown;
}

export interface MediaCollector {
  collect(): Promise<SweepSummary>;
}

interface Deps {
  media: MediaService;
  repository: MediaRepository;
  references: MediaReferenceTracker;
  scanner: MediaGitScanner;
  graceMs: number;
  now?: () => number;
}

/** A sweep that deleted nothing, and says why. */
function refused(reason: SweepRefusal, error: unknown = null): SweepSummary {
  return {
    deleted: 0,
    failed: 0,
    inUse: 0,
    candidates: 0,
    skipped: true,
    reason,
    error,
  };
}

export function createMediaCollector({
  media,
  repository,
  references,
  scanner,
  graceMs,
  now = Date.now,
}: Deps): MediaCollector {
  return {
    async collect() {
      if (!media.isEnabled()) return refused("storage_disabled");

      try {
        references.recompute();
        await scanner.scan();
      } catch (error: unknown) {
        // Something could not be read. Deleting now would be a guess. The
        // error is carried out so the caller can log why nothing happened.
        return refused("scan_failed", error);
      }

      const candidates = repository.findDeletable(now() - graceMs);
      let deleted = 0;
      let failed = 0;
      let inUse = 0;
      for (const record of candidates) {
        try {
          await media.delete(record.id);
          deleted += 1;
        } catch (error: unknown) {
          // A reference appeared since the recheck: the second safety net
          // firing, which is worth seeing apart from a storage failure.
          if (error instanceof MediaError && error.code === "in_use")
            inUse += 1;
          else failed += 1;
        }
      }

      return {
        deleted,
        failed,
        inUse,
        candidates: candidates.length,
        skipped: false,
        reason: null,
        error: null,
      };
    },
  };
}

export interface CollectingOptions {
  collect: () => Promise<SweepSummary>;
  intervalMs: number;
  /** Let the server answer requests before the first sweep. */
  firstRunDelayMs?: number;
  onSweep?: (summary: SweepSummary) => void;
  onError?: (error: unknown) => void;
}

const DEFAULT_FIRST_RUN_MS = 60_000;

/** Runs `collect` on a timer. Returns a function that stops it. */
export function startCollecting({
  collect,
  intervalMs,
  firstRunDelayMs = DEFAULT_FIRST_RUN_MS,
  onSweep,
  onError,
}: CollectingOptions): () => void {
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const run = (): void => {
    collect().then(
      (summary) => onSweep?.(summary),
      // One bad sweep must never stop the next one, or the process.
      (error: unknown) => onError?.(error),
    );
  };

  const first = setTimeout(() => {
    if (stopped) return;
    run();
    interval = setInterval(run, intervalMs);
    interval.unref?.();
  }, firstRunDelayMs);
  first.unref?.();

  return () => {
    stopped = true;
    clearTimeout(first);
    if (interval !== undefined) clearInterval(interval);
  };
}
