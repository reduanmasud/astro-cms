import { describe, expect, it } from "vitest";
import type { SchemaField } from "../api.ts";
import {
  joinTags,
  planField,
  planFields,
  splitTags,
  toControlValue,
  toYamlValue,
} from "./fields.ts";

function field(over: Partial<SchemaField> = {}): SchemaField {
  return { name: "title", type: "string", required: true, ...over };
}

describe("planField", () => {
  it.each([
    ["string", "short", "text"],
    ["number", 3, "number"],
    ["boolean", true, "checkbox"],
    ["date", "2026-01-15", "date"],
  ])("maps %s to a %s control", (type, value, kind) => {
    expect(planField(field({ type }), value).kind).toBe(kind);
  });

  it("uses a textarea when the value has newlines", () => {
    expect(planField(field(), "two\nlines").kind).toBe("textarea");
  });

  it("honours a string format", () => {
    expect(planField(field({ format: "email" }), "a@b.c").kind).toBe("email");
    expect(planField(field({ format: "url" }), "https://x").kind).toBe("url");
  });

  it("maps an enum to a select", () => {
    expect(planField(field({ type: "enum", values: ["a", "b"] })).kind).toBe(
      "select",
    );
  });

  it("maps an array of strings to a tag input", () => {
    const tags = field({ type: "array", items: { type: "string" } });

    expect(planField(tags, ["astro"]).kind).toBe("tags");
  });

  it.each(["literal", "object", "image", "reference", "union", "unknown"])(
    "falls back to a raw box for %s, saying why",
    (type) => {
      const plan = planField(field({ type }), undefined);

      expect(plan.kind).toBe("raw");
      expect(plan.reason).toContain(type);
    },
  );

  it("falls back for an array of anything but strings", () => {
    const plan = planField(
      field({ type: "array", items: { type: "object" } }),
      undefined,
    );

    expect(plan.kind).toBe("raw");
  });

  it("falls back for a date that is not YYYY-MM-DD", () => {
    const plan = planField(field({ type: "date" }), "Jul 08 2023");

    expect(plan.kind).toBe("raw");
    expect(plan.reason).toContain("Jul 08 2023");
  });

  it("keeps the date picker for an empty date", () => {
    expect(planField(field({ type: "date" }), undefined).kind).toBe("date");
  });

  it("falls back for a date value yaml parsed as a number", () => {
    // "20260115" with no separators parses as a YAML number, not a string,
    // so a check against `typeof value === "string"` alone would miss it.
    const plan = planField(field({ type: "date" }), 20260115);

    expect(plan.kind).toBe("raw");
    expect(plan.reason).toContain("20260115");
  });

  it("falls back for an enum value outside its declared values", () => {
    const plan = planField(
      field({ type: "enum", values: ["draft", "published"] }),
      "archived",
    );

    expect(plan.kind).toBe("raw");
    expect(plan.reason).toContain("archived");
  });

  it("keeps the select for an enum value within its declared values", () => {
    const plan = planField(
      field({ type: "enum", values: ["draft", "published"] }),
      "draft",
    );

    expect(plan.kind).toBe("select");
  });

  it("keeps the select for an empty enum value", () => {
    const plan = planField(
      field({ type: "enum", values: ["draft", "published"] }),
      undefined,
    );

    expect(plan.kind).toBe("select");
  });

  it("falls back for a non-numeric number value", () => {
    const plan = planField(field({ type: "number" }), "3 items");

    expect(plan.kind).toBe("raw");
    expect(plan.reason).toContain("3 items");
  });

  it("keeps the number input for a numeric value", () => {
    expect(planField(field({ type: "number" }), 3).kind).toBe("number");
  });

  it("keeps the number input for an empty number value", () => {
    expect(planField(field({ type: "number" }), undefined).kind).toBe("number");
  });
});

describe("splitTags", () => {
  it("splits, trims and drops empties", () => {
    expect(splitTags("astro, cms")).toEqual(["astro", "cms"]);
  });

  it("keeps one tag when a trailing comma has nothing after it", () => {
    expect(splitTags("astro,")).toEqual(["astro"]);
  });

  it("returns no tags for an empty string", () => {
    expect(splitTags("")).toEqual([]);
  });

  it("round-trips with joinTags", () => {
    const tags = ["astro", "cms"];

    expect(splitTags(joinTags(tags))).toEqual(tags);
  });
});

describe("planFields", () => {
  it("plans the schema's fields and reports keys it does not know", () => {
    const { planned, unknownKeys } = planFields(
      [field(), field({ name: "draft", type: "boolean", required: false })],
      ["title", "draft", "legacyId"],
      { title: "Hi", draft: false, legacyId: 4821 },
    );

    expect(planned.map((p) => p.field.name)).toEqual(["title", "draft"]);
    expect(unknownKeys).toEqual(["legacyId"]);
  });
});

describe("toControlValue", () => {
  it.each([
    ["checkbox", true, true],
    ["checkbox", undefined, false],
    ["text", undefined, ""],
    ["number", 3, "3"],
    ["tags", ["a", "b"], ["a", "b"]],
    ["tags", undefined, []],
  ])("%s reads %s as %s", (kind, value, expected) => {
    expect(toControlValue(kind as never, value)).toEqual(expected);
  });

  it("shows an object rather than blanking it", () => {
    expect(toControlValue("raw", { src: "./a.png" })).toBe('{"src":"./a.png"}');
  });
});

describe("toYamlValue", () => {
  const plan = (over: Partial<SchemaField> = {}) =>
    planField(field(over), undefined);

  it("writes a checkbox as a boolean, not a string", () => {
    expect(toYamlValue(plan({ type: "boolean" }), true)).toBe(true);
  });

  it("writes a number as a number, not a string", () => {
    expect(toYamlValue(plan({ type: "number" }), "3")).toBe(3);
  });

  it("writes text as a string", () => {
    expect(toYamlValue(plan(), "Hello")).toBe("Hello");
  });

  it("writes tags as an array", () => {
    expect(
      toYamlValue(plan({ type: "array", items: { type: "string" } }), [
        "astro",
      ]),
    ).toEqual(["astro"]);
  });

  it("removes a nullable field that was cleared", () => {
    expect(toYamlValue(plan({ nullable: true }), "")).toBeUndefined();
  });

  it("removes an optional (non-nullable) field that was cleared", () => {
    // `.optional()` in an Astro content schema sets `required: false` and
    // leaves `nullable` unset — only `.nullable()` sets that. Clearing such
    // a field must remove the key, not write "" (which a coerced type like
    // `z.coerce.date()` then rejects on the next build).
    expect(toYamlValue(plan({ required: false }), "")).toBeUndefined();
  });

  it("keeps an empty value for a required field", () => {
    expect(toYamlValue(plan(), "")).toBe("");
  });
});
