import { parseDocument, stringify, type Document } from "yaml";

/**
 * Frontmatter as an editable document rather than an opaque string.
 *
 * Edits are surgical: `yaml`'s Document API keeps the comments, key order and
 * quoting of every key nobody touched, so opening a hand-written post and
 * ticking one checkbox does not reformat the rest
 * (docs/superpowers/specs/2026-09-16-frontmatter-fields-design.md).
 */

/** What a control can write back into the document. */
export type FrontmatterValue = string | number | boolean | null | string[];

export interface FrontmatterDocument {
  /** The value as plain JSON, or undefined when the key is absent. */
  get(key: string): unknown;
  set(key: string, value: FrontmatterValue): void;
  /** The value as YAML text, for a field with no control. */
  getRaw(key: string): string;
  /** Writes YAML text. False when it does not parse; the document is untouched. */
  setRaw(key: string, yamlText: string): boolean;
  remove(key: string): void;
  /** Keys in the order the file has them. */
  keys(): string[];
  toString(): string;
}

// Two `yaml` defaults would otherwise reformat keys nobody touched on every
// save: `flowCollectionPadding` turns `tags: [a, b]` into `tags: [ a, b ]`,
// and `lineWidth: 80` reflows any long scalar (e.g. a one-line `description`)
// across multiple lines. Both are disabled so editing one key never
// disturbs the rest of the document.
const STRINGIFY = { flowCollectionPadding: false, lineWidth: 0 };

/** Parses frontmatter, or undefined when the source is not valid YAML. */
export function parseFrontmatter(
  source: string | null,
): FrontmatterDocument | undefined {
  const doc = parseDocument(source ?? "");
  return doc.errors.length > 0 ? undefined : wrap(doc);
}

function wrap(doc: Document): FrontmatterDocument {
  const json = (): Record<string, unknown> =>
    (doc.toJSON() as Record<string, unknown> | null) ?? {};

  return {
    get: (key) => json()[key],
    set: (key, value) => {
      doc.set(key, value);
    },
    remove: (key) => {
      doc.delete(key);
    },
    keys: () => Object.keys(json()),

    // The raw boxes: a type with no control, and keys outside the schema.
    // `stringify(undefined, …)` returns `undefined`, not a string, so an
    // absent key must be handled before calling it rather than after.
    getRaw: (key) => {
      const value = json()[key];
      return value === undefined ? "" : stringify(value, STRINGIFY).trimEnd();
    },
    setRaw: (key, yamlText) => {
      const parsed = parseDocument(yamlText);
      if (parsed.errors.length > 0) return false;
      doc.set(key, parsed.toJSON());
      return true;
    },

    // An empty document stringifies to "null\n". A post with no frontmatter
    // must keep having none rather than gaining a literal null.
    toString: () => (doc.contents === null ? "" : doc.toString(STRINGIFY)),
  };
}
