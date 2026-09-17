import { describe, expect, it } from "vitest";
import { listAction, type ListRequest, type ListState } from "./listAction.ts";

/**
 * `listAction` decides whether a list response may still be applied. It
 * exists because the sequence guard alone only protects against a newer
 * *response* winning — not against a request built from stale
 * render-closure values (offset, filter) that changed before the click
 * that built it was processed (docs/superpowers/specs/2026-09-16-media-library-design.md).
 */
describe("listAction", () => {
  it("replaces when the newest request is for the first page", () => {
    const request: ListRequest = { sequence: 3, offset: 0, unused: false };
    const state: ListState = { sequence: 3, count: 24, unused: false };

    expect(listAction(request, state)).toBe("replace");
  });

  it("appends when the newest request's offset matches the current count", () => {
    const request: ListRequest = { sequence: 3, offset: 24, unused: false };
    const state: ListState = { sequence: 3, count: 24, unused: false };

    expect(listAction(request, state)).toBe("append");
  });

  it("discards a request from a superseded sequence", () => {
    const request: ListRequest = { sequence: 2, offset: 0, unused: false };
    const state: ListState = { sequence: 3, count: 24, unused: false };

    expect(listAction(request, state)).toBe("discard");
  });

  it("discards a request whose filter differs from the current filter", () => {
    // The cross-control race this module exists to close: unchecking
    // "Unused only" fires request N (offset 0, unused=false), then before
    // React re-renders (disabled={loading} hasn't applied yet) a click on
    // "Load more" reads the still-stale closure — offset 24, unused=true —
    // and fires request N+1. N+1's sequence is newest and its offset (24)
    // happens to match the current count, so a guard that checks only
    // sequence and offset would append unused-only items onto the
    // now-unfiltered list. The filter must be checked too.
    const request: ListRequest = { sequence: 5, offset: 24, unused: true };
    const state: ListState = { sequence: 5, count: 24, unused: false };

    expect(listAction(request, state)).toBe("discard");
  });

  it("discards a request whose offset is neither 0 nor the current count", () => {
    const request: ListRequest = { sequence: 4, offset: 48, unused: false };
    const state: ListState = { sequence: 4, count: 24, unused: false };

    expect(listAction(request, state)).toBe("discard");
  });
});
