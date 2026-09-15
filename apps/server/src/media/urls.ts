/**
 * Spotting our own media in text. One matcher, used by the draft tracker and
 * the repository scanner, so the two can never drift apart.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Object keys of our own media mentioned anywhere in `source`. */
export function mediaKeysIn(
  source: string,
  publicUrl: string | null,
): string[] {
  if (publicUrl === null) return [];
  const base = publicUrl.replace(/\/+$/, "");
  const found = new Set<string>();
  // Matches the URL wherever it appears: Markdown, HTML, or MDX props.
  const pattern = new RegExp(`${escapeRegExp(base)}/([A-Za-z0-9/_.-]+)`, "g");
  for (const match of source.matchAll(pattern)) {
    const key = match[1];
    if (key !== undefined) found.add(key);
  }
  return [...found];
}
