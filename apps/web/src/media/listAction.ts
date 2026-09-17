/**
 * Whether a list response may still be applied when it arrives.
 *
 * A response can be unusable in two different ways, and a caller must not
 * treat them the same:
 *
 * - `"superseded"`: a newer request already exists. Silently ignoring this
 *   one is safe — that newer request is the one that will clear any
 *   "loading" flag when it lands.
 * - `"discard"`: this is still the newest request, but it was built from
 *   render-closure values (offset or filter) that no longer match reality —
 *   e.g. a click that beat React's re-render sent yesterday's offset and
 *   filter, or a delete landed while this request was in flight and shifted
 *   the count it was counting on. Nothing else is coming to clear a
 *   "loading" flag, so the caller must do that itself. Collapsing this into
 *   `"superseded"` (or into one "discard" case a caller always ignores) is
 *   exactly the bug that produced a permanently stuck "Loading…" button.
 */
export type ListAction = "replace" | "append" | "discard" | "superseded";

export interface ListRequest {
  readonly sequence: number;
  readonly offset: number;
  readonly unused: boolean;
}

export interface ListState {
  readonly sequence: number;
  readonly count: number;
  readonly unused: boolean;
}

export function listAction(request: ListRequest, state: ListState): ListAction {
  if (request.sequence !== state.sequence) return "superseded";
  if (request.unused !== state.unused) return "discard";
  if (request.offset === 0) return "replace";
  return request.offset === state.count ? "append" : "discard";
}
