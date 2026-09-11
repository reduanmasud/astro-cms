export type RateLimiter = {
  /** True when `key` has reached its limit in the current window. Does not count as a hit. */
  isBlocked(key: string): boolean;
  /** Records one hit (e.g. a failed login) for `key`. */
  hit(key: string): void;
};

type Options = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

const SWEEP_THRESHOLD = 1000;

/**
 * Fixed-window, in-memory rate limiter. In-memory is enough because the CMS
 * runs as one process (docs/adr/0001-single-node-process.md).
 */
export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: Options): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  function activeCount(key: string, time: number): number {
    const window = windows.get(key);
    return window && time - window.start < windowMs ? window.count : 0;
  }

  function sweep(time: number): void {
    for (const [key, window] of windows) {
      if (time - window.start >= windowMs) windows.delete(key);
    }
  }

  return {
    isBlocked(key) {
      return activeCount(key, now()) >= limit;
    },

    hit(key) {
      const time = now();
      if (windows.size >= SWEEP_THRESHOLD) sweep(time);

      const count = activeCount(key, time);
      const start = count === 0 ? time : (windows.get(key)?.start ?? time);
      windows.set(key, { start, count: count + 1 });
    },
  };
}
