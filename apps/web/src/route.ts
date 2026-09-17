/** Which screen the signed-in user is on. */
export type View =
  | { name: "browse" }
  | { name: "collection"; collectionName: string }
  | { name: "edit"; documentId: string; collectionName: string }
  | { name: "media" }
  | { name: "status" };

/**
 * The URL a view corresponds to, so reloading or sharing a link lands back
 * on the same screen instead of always resetting to browse.
 */
export function viewToPath(view: View): string {
  switch (view.name) {
    case "browse":
      return "/";
    case "collection":
      return `/c/${encodeURIComponent(view.collectionName)}`;
    case "edit":
      return `/c/${encodeURIComponent(view.collectionName)}/${encodeURIComponent(view.documentId)}`;
    case "media":
      return "/media";
    case "status":
      return "/status";
  }
}

/** The inverse of {@link viewToPath}. Unrecognized paths fall back to browse. */
export function pathToView(pathname: string): View {
  const parts = pathname
    .split("/")
    .filter((part) => part !== "")
    .map(decodeURIComponent);

  if (parts.length === 0) return { name: "browse" };
  if (parts[0] === "media") return { name: "media" };
  if (parts[0] === "status") return { name: "status" };
  if (parts[0] === "c" && parts[1] !== undefined) {
    const collectionName = parts[1];
    return parts[2] !== undefined
      ? { name: "edit", documentId: parts[2], collectionName }
      : { name: "collection", collectionName };
  }
  return { name: "browse" };
}
