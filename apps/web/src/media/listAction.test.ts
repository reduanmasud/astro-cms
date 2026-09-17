import { describe, expect, it } from "vitest";
import { listAction, type ListRequest, type ListState } from "./listAction.ts";

/**
 * `listAction` decides whether a list response may still be applied. It
 * exists because the sequence guard alone only protects against a newer
 * *response* winning — not against a request built from stale
 * render-closure values (offset, filter) that changed before the click
 * that built it was processed (docs/superpowers/specs/2026-09-16-media-library-design.md).
 *
 * It also splits "unusable" into `"superseded"` and `"discard"` rather than
 * collapsing both into one outcome. They carry different caller
 * obligations: a superseded request can be silently ignored (the newer
 * request that replaced it will clear any "loading" flag), but a discarded
 * request is still the newest one in flight — nothing else is coming, so
 * the caller must clear "loading" itself. Treating them the same produced a
 * real regression: a request that outlives a delete (which shifts the
 * count it was counting on) discarded silently and left the UI stuck on
 * "Loading…" forever.
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

  it("supersedes a request from an older sequence", () => {
    // A strictly newer request exists; that request owns clearing
    // "loading" when it lands, so this one is silently ignorable.
    const request: ListRequest = { sequence: 2, offset: 0, unused: false };
    const state: ListState = { sequence: 3, count: 24, unused: false };

    expect(listAction(request, state)).toBe("superseded");
  });

  it("discards, rather than supersedes, a same-sequence request whose filter differs from the current filter", () => {
    // The cross-control race this module exists to close: unchecking
    // "Unused only" fires request N (offset 0, unused=false), then before
    // React re-renders (disabled={loading} hasn't applied yet) a click on
    // "Load more" reads the still-stale closure — offset 24, unused=true —
    // and fires request N+1. N+1's sequence is newest and its offset (24)
    // happens to match the current count, so a guard that checks only
    // sequence and offset would append unused-only items onto the
    // now-unfiltered list. The filter must be checked too. Because this is
    // the newest sequence, the outcome must be "discard", not
    // "superseded" — nothing else will clear "loading" for it.
    const request: ListRequest = { sequence: 5, offset: 24, unused: true };
    const state: ListState = { sequence: 5, count: 24, unused: false };

    expect(listAction(request, state)).toBe("discard");
  });

  it("discards, rather than supersedes, a same-sequence request whose offset no longer matches the count", () => {
    // The regression this split fixes: "Load more" is in flight (offset
    // built from the pre-delete count) when a delete elsewhere shrinks the
    // tracked count. No newer list request was made — this is still the
    // newest sequence — so the outcome must be "discard", not
    // "superseded", or nothing is left to clear "loading".
    const request: ListRequest = { sequence: 4, offset: 24, unused: false };
    const state: ListState = { sequence: 4, count: 23, unused: false };

    expect(listAction(request, state)).toBe("discard");
  });

  it("discards a request whose offset is neither 0 nor the current count", () => {
    const request: ListRequest = { sequence: 4, offset: 48, unused: false };
    const state: ListState = { sequence: 4, count: 24, unused: false };

    expect(listAction(request, state)).toBe("discard");
  });
});
