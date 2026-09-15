import type { MediaRepository } from "../db/media-repository.ts";
import type { MediaGitScanner } from "./media-git-scanner.ts";
import type { MediaReferenceTracker } from "./media-references.ts";
import type { MediaService } from "./media.ts";

/**
 * Deleting media nothing uses any more (docs/adr/0008-media-storage-and-gc.md).
 *
 * A sweep recomputes every reference first — drafts, the base branch, and open
 * CMS branches — and that recompute *is* the recheck the ADR requires. If any
 * of it fails, the sweep deletes nothing: zero references from a failed scan
 * looks exactly like zero references from a real one, and deletion here has to
 * be proof, not assumption.
 */

export interface SweepSummary {
  readonly deleted: number;
  /** Files whose object could not be removed; their rows are kept. */
  readonly failed: number;
  /** Files old enough to delete when the sweep began. */
  readonly candidates: number;
  /** True when the sweep refused to delete: storage off, or a scan failed. */
  readonly skipped: boolean;
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

const NOTHING: SweepSummary = {
  deleted: 0,
  failed: 0,
  candidates: 0,
  skipped: true,
};

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
      if (!media.isEnabled()) return NOTHING;

      try {
        references.recompute();
        await scanner.scan();
      } catch {
        // Something could not be read. Deleting now would be a guess.
        return NOTHING;
      }

      const candidates = repository.findDeletable(now() - graceMs);
      let deleted = 0;
      let failed = 0;
      for (const record of candidates) {
        try {
          await media.delete(record.id);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }

      return { deleted, failed, candidates: candidates.length, skipped: false };
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
