import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limiter.ts";

describe("createRateLimiter", () => {
  it("blocks a key once it reaches the limit within a window", () => {
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => 0,
    });

    limiter.hit("a");
    expect(limiter.isBlocked("a")).toBe(false);
    limiter.hit("a");
    expect(limiter.isBlocked("a")).toBe(true);
  });

  it("does not count checks as hits", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => 0,
    });

    limiter.isBlocked("a");
    limiter.isBlocked("a");

    expect(limiter.isBlocked("a")).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => 0,
    });

    limiter.hit("a");

    expect(limiter.isBlocked("a")).toBe(true);
    expect(limiter.isBlocked("b")).toBe(false);
  });

  it("unblocks after the window passes", () => {
    let now = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => now,
    });

    limiter.hit("a");
    now = 1000;

    expect(limiter.isBlocked("a")).toBe(false);
  });

  it("keeps limiting active keys after sweeping expired ones", () => {
    let now = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => now,
    });
    for (let i = 0; i < 1000; i++) limiter.hit(`old-${i}`);
    now = 1000;
    limiter.hit("active");
    limiter.hit("trigger-sweep");

    expect(limiter.isBlocked("active")).toBe(true);
    expect(limiter.isBlocked("old-0")).toBe(false);
  });
});
