import { useState, type JSX } from "react";
import { joinTags, splitTags, type ControlKind } from "./fields.ts";

/** One labelled control. The label is the field name, as the schema has it. */
export interface ControlProps {
  id: string;
  kind: ControlKind;
  value: string | boolean | string[];
  values?: unknown[];
  onChange: (value: string | boolean | string[]) => void;
}

export function Control({
  id,
  kind,
  value,
  values,
  onChange,
}: ControlProps): JSX.Element {
  if (kind === "checkbox") {
    return (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (kind === "select") {
    return (
      <select
        id={id}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">—</option>
        {(values ?? []).map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }

  if (kind === "tags") {
    const tags = Array.isArray(value) ? value : [];
    return <TagsControl id={id} value={tags} onChange={onChange} />;
  }

  if (kind === "textarea" || kind === "raw") {
    return (
      <textarea
        id={id}
        rows={Math.min(8, String(value).split("\n").length + 1)}
        spellCheck={false}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (kind === "number") {
    return <NumberControl id={id} value={String(value)} onChange={onChange} />;
  }

  const type =
    kind === "date"
      ? "date"
      : kind === "email"
        ? "email"
        : kind === "url"
          ? "url"
          : "text";

  return (
    <input
      id={id}
      type={type}
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

interface TagsControlProps {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * Its own component, not a branch inside `Control`: it needs `useState` for
 * the text being typed, and the React Compiler's rules forbid a hook behind
 * a conditional branch of a plain function.
 *
 * Same reasoning as `FrontmatterFields`' `rawText`: driving the input's
 * `value` straight from the parsed `tags` array means a keystroke that
 * doesn't yet change the array — typing the comma after "astro", or a
 * space after it — leaves the `value` prop unchanged, and React then
 * resets the DOM node back to that unchanged prop, erasing the very
 * character just typed. Holding the typed text here breaks that loop: the
 * text always updates, and `onChange` still fires with the parsed tags on
 * every keystroke.
 */
function TagsControl({ id, value, onChange }: TagsControlProps): JSX.Element {
  const [text, setText] = useState<string>();

  return (
    <input
      id={id}
      type="text"
      value={text ?? joinTags(value)}
      placeholder="comma separated"
      onChange={(event) => {
        setText(event.target.value);
        onChange(splitTags(event.target.value));
      }}
    />
  );
}

interface NumberControlProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Its own component for the same reason as `TagsControl`: it needs
 * `useState` for the text being typed, and the React Compiler's rules
 * forbid a hook behind a conditional branch of a plain function.
 *
 * Driving the input's `value` straight from the document means a keystroke
 * that doesn't yet change the stored value — typing the "." in "3.", or a
 * leading zero in "007" — leaves the `value` prop unchanged (`toYamlValue`
 * parses "3." to the number 3, and `toControlValue` turns that back into
 * "3"), and React then resets the DOM node back to that unchanged prop,
 * erasing the very character just typed. Holding the typed text here
 * breaks that loop: the text always updates, and `onChange` still fires
 * with the typed string on every keystroke, exactly as the number branch
 * always did — `toYamlValue` already converts it, falling back to the raw
 * string when `Number()` gives NaN.
 */
function NumberControl({
  id,
  value,
  onChange,
}: NumberControlProps): JSX.Element {
  const [text, setText] = useState<string>();

  return (
    <input
      id={id}
      type="number"
      value={text ?? value}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value);
      }}
    />
  );
}
