import type { SchemaField } from "../api.ts";
import type { FrontmatterValue } from "./document.ts";

/**
 * Turning a collection's schema into controls. Pure: every decision about
 * which control a field gets, and how a control's value becomes YAML, lives
 * here so it can be tested without a browser.
 */

export type ControlKind =
  | "text"
  | "textarea"
  | "email"
  | "url"
  | "number"
  | "checkbox"
  | "date"
  | "select"
  | "tags"
  | "raw";

export interface FieldPlan {
  readonly field: SchemaField;
  readonly kind: ControlKind;
  /** Why this field fell back, when `kind` is "raw". */
  readonly reason?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Types a wrong control would serve worse than no control at all. */
const NO_CONTROL = new Set([
  "literal",
  "object",
  "image",
  "reference",
  "union",
  "unknown",
]);

export function planField(field: SchemaField, value?: unknown): FieldPlan {
  if (field.type === "enum") return { field, kind: "select" };
  if (field.type === "array") {
    return field.items?.type === "string"
      ? { field, kind: "tags" }
      : {
          field,
          kind: "raw",
          reason: `an array of ${field.items?.type ?? "unknown"} has no control yet`,
        };
  }
  if (NO_CONTROL.has(field.type)) {
    return { field, kind: "raw", reason: `${field.type} has no control yet` };
  }
  if (field.type === "number") return { field, kind: "number" };
  if (field.type === "boolean") return { field, kind: "checkbox" };
  if (field.type === "date") {
    // <input type="date"> requires YYYY-MM-DD. A hand-written value like
    // "Jul 08 2023" would render as a silently blank picker with the data
    // still intact underneath, so it falls back to the raw box instead.
    if (typeof value === "string" && value !== "" && !ISO_DATE.test(value)) {
      return {
        field,
        kind: "raw",
        reason: `date value "${value}" is not in YYYY-MM-DD format`,
      };
    }
    return { field, kind: "date" };
  }

  if (field.format === "email") return { field, kind: "email" };
  if (field.format === "url") return { field, kind: "url" };
  // A value that already spans lines wants room to breathe.
  return {
    field,
    kind:
      typeof value === "string" && value.includes("\n") ? "textarea" : "text",
  };
}

export function planFields(
  fields: readonly SchemaField[],
  keys: readonly string[],
  values: Readonly<Record<string, unknown>>,
): { planned: FieldPlan[]; unknownKeys: string[] } {
  const known = new Set(fields.map((field) => field.name));
  return {
    planned: fields.map((field) => planField(field, values[field.name])),
    unknownKeys: keys.filter((key) => !known.has(key)),
  };
}

/** The document's value as the control wants it. */
export function toControlValue(
  kind: ControlKind,
  value: unknown,
): string | boolean | string[] {
  if (kind === "checkbox") return value === true;
  if (kind === "tags") return Array.isArray(value) ? value.map(String) : [];
  if (value === undefined || value === null) return "";
  // Show objects as JSON to preserve data visibility in raw controls.
  // ESLint's no-base-to-string would reject String() for objects,
  // so JSON.stringify avoids data loss while keeping linting clean.
  if (typeof value === "object") return JSON.stringify(value);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}

/** The control's value as YAML. Undefined means: remove the key. */
export function toYamlValue(
  plan: FieldPlan,
  raw: string | boolean | string[],
): FrontmatterValue | undefined {
  const empty = raw === "" || (Array.isArray(raw) && raw.length === 0);
  if (empty && plan.field.nullable === true) return undefined;

  if (plan.kind === "checkbox") return raw === true;
  if (plan.kind === "tags") return Array.isArray(raw) ? raw : [];
  if (plan.kind === "number") {
    if (raw === "") return "";
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? String(raw) : parsed;
  }
  return String(raw);
}
