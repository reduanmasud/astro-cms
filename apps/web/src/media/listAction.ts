/**
 * Whether a list response may still be applied when it arrives.
 *
 * A response can be stale in two independent ways: a newer request was made
 * after it, or the request itself was built from render-closure values that
 * had already changed — the second is how a click that beats React's
 * re-render sends yesterday's offset and filter.
 */
export type ListAction = "replace" | "append" | "discard";

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
  if (request.sequence !== state.sequence) return "discard";
  if (request.unused !== state.unused) return "discard";
  if (request.offset === 0) return "replace";
  return request.offset === state.count ? "append" : "discard";
}
