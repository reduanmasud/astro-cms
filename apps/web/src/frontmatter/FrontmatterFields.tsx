import { useState, type JSX } from "react";
import type { SchemaField } from "../api.ts";
import { Control } from "./controls.tsx";
import type { FrontmatterDocument } from "./document.ts";
import {
  planFields,
  toControlValue,
  toYamlValue,
  type FieldPlan,
} from "./fields.ts";

export interface FrontmatterFieldsProps {
  schema: readonly SchemaField[];
  document: FrontmatterDocument;
  /** Called after every edit, so the editor can re-serialise and autosave. */
  onChange: () => void;
}

/**
 * The collection's schema as controls. The document is edited in place; the
 * editor owns serialising it (docs/adr/0007-frontmatter-schema-inference.md).
 */
export function FrontmatterFields({
  schema,
  document,
  onChange,
}: FrontmatterFieldsProps): JSX.Element {
  // The document is the state; this only asks React to read it again. Never
  // used as a `key` — that would remount the inputs and lose focus mid-word.
  const [, bump] = useState(0);
  const [badYaml, setBadYaml] = useState<Readonly<Record<string, boolean>>>({});
  const [rawText, setRawText] = useState<Readonly<Record<string, string>>>({});

  const values = Object.fromEntries(
    document.keys().map((key) => [key, document.get(key)]),
  );
  const { planned, unknownKeys } = planFields(schema, document.keys(), values);

  function touched(): void {
    bump((count) => count + 1);
    onChange();
  }

  function write(plan: FieldPlan, raw: string | boolean | string[]): void {
    const value = toYamlValue(plan, raw);
    if (value === undefined) document.remove(plan.field.name);
    else document.set(plan.field.name, value);
    touched();
  }

  /**
   * A raw box: the text is the person's, and the document only receives it
   * once it parses. Half-typed YAML — an opening bracket, an unclosed
   * quote — must survive the keystroke that made it invalid, so the text
   * lives in state and the document keeps its last good value.
   */
  function writeRaw(key: string, text: string): void {
    setRawText((previous) => ({ ...previous, [key]: text }));
    // `parseDocument("")` reports zero errors and `toJSON()` returns null,
    // so writing an empty box through `setRaw` would write `key: null`
    // rather than clearing it — turning `heroImage: ./a.png` into
    // `heroImage: null`, which a schema like `image().optional()` then
    // rejects on the next build. An empty or whitespace-only box means the
    // key should go away, the same as clearing a schema-backed field.
    if (text.trim() === "") {
      document.remove(key);
      setBadYaml((previous) => ({ ...previous, [key]: false }));
      touched();
      return;
    }
    const ok = document.setRaw(key, text);
    setBadYaml((previous) => ({ ...previous, [key]: !ok }));
    if (ok) touched();
  }

  return (
    <div className="frontmatter-fields">
      {planned.map((plan) => {
        const name = plan.field.name;
        const isRaw = plan.kind === "raw";
        const raw = isRaw
          ? (rawText[name] ?? document.getRaw(name))
          : toControlValue(plan.kind, document.get(name));
        // `false` is a real value for a checkbox, not an empty one.
        const missing =
          plan.field.required &&
          (raw === "" || (Array.isArray(raw) && raw.length === 0));

        return (
          <label key={name} htmlFor={`fm-${name}`}>
            <span>
              {name}
              {plan.field.required && <abbr title="required">*</abbr>}
            </span>
            <Control
              id={`fm-${name}`}
              kind={plan.kind}
              value={raw}
              values={plan.field.values}
              onChange={(value) => {
                if (isRaw) writeRaw(name, String(value));
                else write(plan, value);
              }}
            />
            {plan.reason !== undefined && (
              <small className="hint">{plan.reason} — edit it as YAML</small>
            )}
            {badYaml[name] === true && (
              <small className="hint" role="alert">
                not valid YAML, so this field is unchanged
              </small>
            )}
            {missing && <small className="hint">required, still empty</small>}
          </label>
        );
      })}

      {unknownKeys.length > 0 && (
        <fieldset className="frontmatter-other">
          <legend>Other fields</legend>
          <p className="hint">
            These are in the file but not in the collection&apos;s schema. They
            are kept as they are.
          </p>
          {unknownKeys.map((key) => (
            <label key={key} htmlFor={`fm-other-${key}`}>
              <span>{key}</span>
              <Control
                id={`fm-other-${key}`}
                kind="raw"
                value={rawText[key] ?? document.getRaw(key)}
                onChange={(value) => {
                  writeRaw(key, String(value));
                }}
              />
              {badYaml[key] === true && (
                <small className="hint" role="alert">
                  not valid YAML, so this field is unchanged
                </small>
              )}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
