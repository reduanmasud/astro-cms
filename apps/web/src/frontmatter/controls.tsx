import type { JSX } from "react";
import type { ControlKind } from "./fields.ts";

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
    return (
      <input
        id={id}
        type="text"
        value={tags.join(", ")}
        placeholder="comma separated"
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter((tag) => tag !== ""),
          )
        }
      />
    );
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

  const type =
    kind === "number"
      ? "number"
      : kind === "date"
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
