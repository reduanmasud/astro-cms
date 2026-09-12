import { parse } from "@babel/parser";
import type {
  Expression,
  Node,
  ObjectExpression,
  Statement,
} from "@babel/types";

/**
 * Reads collection definitions from an Astro content config
 * (`src/content.config.ts`) by static analysis only. The file is parsed,
 * never executed (docs/adr/0007-frontmatter-schema-inference.md). Anything
 * that cannot be understood safely is reported as `unknown` or "not inferred"
 * so the UI can fall back to a raw frontmatter editor.
 */

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "literal"
  | "array"
  | "object"
  | "image"
  | "reference"
  | "union"
  | "unknown";

export type LiteralValue = string | number | boolean | null | LiteralValue[];

/** The type of a value, without a name. Used for array items. */
export interface FieldShape {
  readonly type: FieldType;
  readonly nullable?: true;
  readonly format?: "email" | "url";
  /** Allowed values for `enum` and `literal`. */
  readonly values?: readonly LiteralValue[];
  /** Item type for `array`. */
  readonly items?: FieldShape;
  /** Nested fields for `object`. */
  readonly fields?: readonly SchemaField[];
  /** Target collection for `reference`. */
  readonly collection?: string;
}

export interface SchemaField extends FieldShape {
  readonly name: string;
  readonly required: boolean;
  readonly default?: LiteralValue;
}

export type CollectionSchema =
  | { readonly inferred: true; readonly fields: readonly SchemaField[] }
  | { readonly inferred: false; readonly reason: string };

export type LoaderKind =
  "glob" | "file" | "legacy-content" | "legacy-data" | "custom";

export interface CollectionDefinition {
  readonly name: string;
  readonly loader: LoaderKind;
  /** Directory (glob, legacy) or file (file loader) inside the repository. */
  readonly contentPath: string | null;
  readonly pattern: string | null;
  /** File extensions the collection reads, e.g. ["md", "mdx"]. */
  readonly formats: readonly string[];
  readonly schema: CollectionSchema;
}

export interface ContentConfig {
  readonly collections: readonly CollectionDefinition[];
  readonly warnings: readonly string[];
}

/** A parsed value type plus the modifiers that apply to the field holding it. */
interface TypeInfo {
  readonly shape: FieldShape;
  readonly required: boolean;
  readonly default?: LiteralValue;
}

const MAX_DEPTH = 20;
const UNKNOWN: TypeInfo = { shape: { type: "unknown" }, required: true };

export function parseContentConfig(source: string): ContentConfig {
  let body: Statement[];
  try {
    body = parse(source, { sourceType: "module", plugins: ["typescript"] })
      .program.body;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      collections: [],
      warnings: [`Could not parse the content config: ${reason}`],
    };
  }

  const scope = new Scope(body);
  const exported = scope.exportedCollections();
  if (exported === undefined) {
    return {
      collections: [],
      warnings: ["No `export const collections = { ... }` found."],
    };
  }

  const collections = exported.properties.flatMap((property) => {
    if (property.type !== "ObjectProperty") return [];
    const name = propertyName(property.key);
    if (name === undefined) return [];
    return [parseCollection(name, property.value as Expression, scope)];
  });
  return { collections, warnings: [] };
}

/** Top-level `const` declarations, used to follow identifiers to their values. */
class Scope {
  private readonly values = new Map<string, Expression>();
  private readonly exports = new Set<string>();
  private readonly aliases = new Map<string, string>();

  constructor(body: readonly Statement[]) {
    for (const statement of body) {
      const declaration =
        statement.type === "ExportNamedDeclaration"
          ? statement.declaration
          : statement;
      if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === "Identifier" && declarator.init) {
            this.values.set(declarator.id.name, declarator.init);
            if (statement.type === "ExportNamedDeclaration")
              this.exports.add(declarator.id.name);
          }
        }
      }
      if (statement.type === "ExportNamedDeclaration") {
        for (const specifier of statement.specifiers) {
          if (specifier.type !== "ExportSpecifier") continue;
          const local = propertyName(specifier.local);
          if (
            propertyName(specifier.exported) === "collections" &&
            local !== undefined
          ) {
            // `export { blogCollections as collections }` is read as "collections".
            this.exports.add("collections");
            if (local !== "collections") this.aliases.set("collections", local);
          }
        }
      }
    }
  }

  exportedCollections(): ObjectExpression | undefined {
    if (!this.exports.has("collections")) return undefined;
    const local = this.aliases.get("collections") ?? "collections";
    const value = this.resolve(this.values.get(local), 0);
    return value?.type === "ObjectExpression" ? value : undefined;
  }

  /** Unwraps TypeScript wrappers and follows identifiers to their declared value. */
  resolve(
    expression: Node | null | undefined,
    depth: number,
  ): Expression | undefined {
    const node = unwrap(expression);
    if (node === undefined || depth > MAX_DEPTH) return undefined;
    if (node.type === "Identifier") {
      const value = this.values.get(node.name);
      return value === undefined ? node : this.resolve(value, depth + 1);
    }
    return node;
  }
}

function parseCollection(
  name: string,
  value: Expression,
  scope: Scope,
): CollectionDefinition {
  const definition = scope.resolve(value, 0);
  const options =
    definition?.type === "CallExpression" &&
    definition.callee.type === "Identifier" &&
    definition.callee.name === "defineCollection"
      ? unwrap(definition.arguments[0])
      : undefined;

  if (options?.type !== "ObjectExpression") {
    return {
      name,
      loader: "custom",
      contentPath: null,
      pattern: null,
      formats: [],
      schema: {
        inferred: false,
        reason: "The collection is not defined with defineCollection({ ... }).",
      },
    };
  }

  return {
    name,
    ...parseLoader(name, options, scope),
    schema: parseSchema(getProperty(options, "schema"), scope),
  };
}

function parseLoader(
  name: string,
  options: ObjectExpression,
  scope: Scope,
): Pick<
  CollectionDefinition,
  "loader" | "contentPath" | "pattern" | "formats"
> {
  const loader = scope.resolve(getProperty(options, "loader"), 0);

  if (loader === undefined) {
    const type = stringValue(getProperty(options, "type"));
    return type === "data"
      ? {
          loader: "legacy-data",
          contentPath: `src/content/${name}`,
          pattern: null,
          formats: ["json", "yaml"],
        }
      : {
          loader: "legacy-content",
          contentPath: `src/content/${name}`,
          pattern: null,
          formats: ["md", "mdx"],
        };
  }

  if (loader.type === "CallExpression" && loader.callee.type === "Identifier") {
    const argument = unwrap(loader.arguments[0]);

    if (
      loader.callee.name === "glob" &&
      argument?.type === "ObjectExpression"
    ) {
      const patterns = stringList(getProperty(argument, "pattern"));
      const base = stringValue(getProperty(argument, "base"));
      return {
        loader: "glob",
        contentPath: normalizePath(base ?? "."),
        pattern: patterns.join(", ") || null,
        formats: unique(patterns.flatMap(extensionsOf)),
      };
    }

    const filePath = stringValue(argument);
    if (loader.callee.name === "file" && filePath !== undefined) {
      const normalized = normalizePath(filePath);
      return {
        loader: "file",
        contentPath: normalized,
        pattern: null,
        formats: extensionsOf(normalized),
      };
    }
  }

  return { loader: "custom", contentPath: null, pattern: null, formats: [] };
}

function parseSchema(value: Node | undefined, scope: Scope): CollectionSchema {
  if (value === undefined)
    return { inferred: false, reason: "The collection has no schema." };

  let schema = scope.resolve(value, 0);
  // `schema: ({ image }) => z.object({ ... })`
  if (
    schema?.type === "ArrowFunctionExpression" ||
    schema?.type === "FunctionExpression"
  ) {
    schema = scope.resolve(returnedExpression(schema.body), 0);
  }

  const info = schema === undefined ? UNKNOWN : parseType(schema, scope, 0);
  return info.shape.type === "object" && info.shape.fields
    ? { inferred: true, fields: info.shape.fields }
    : {
        inferred: false,
        reason: "The schema is not a z.object(...) expression.",
      };
}

/** Parses a Zod expression such as `z.string().url().optional()`. */
function parseType(expression: Node, scope: Scope, depth: number): TypeInfo {
  const node = scope.resolve(expression, depth);
  if (node === undefined || depth > MAX_DEPTH || node.type !== "CallExpression")
    return UNKNOWN;

  const { callee } = node;
  const args = node.arguments as Node[];

  if (callee.type === "Identifier") {
    if (callee.name === "image") return base({ type: "image" });
    const target = stringValue(args[0]);
    if (callee.name === "reference" && target !== undefined) {
      return base({ type: "reference", collection: target });
    }
    return UNKNOWN;
  }

  if (
    callee.type !== "MemberExpression" ||
    callee.property.type !== "Identifier"
  )
    return UNKNOWN;
  const method = callee.property.name;

  return isZod(callee.object)
    ? parseConstructor(method, args, scope, depth)
    : applyModifier(
        parseType(callee.object, scope, depth + 1),
        method,
        args,
        scope,
        depth,
      );
}

/** `z.string()`, `z.enum([...])`, `z.object({...})`, `z.coerce.date()`, ... */
function parseConstructor(
  method: string,
  args: Node[],
  scope: Scope,
  depth: number,
): TypeInfo {
  switch (method) {
    case "string":
    case "number":
    case "boolean":
    case "date":
      return base({ type: method });
    case "bigint":
      return base({ type: "number" });
    case "enum": {
      const values = literalValue(scope.resolve(args[0], depth));
      return Array.isArray(values) ? base({ type: "enum", values }) : UNKNOWN;
    }
    case "literal": {
      const value = literalValue(args[0]);
      return value === undefined
        ? UNKNOWN
        : base({ type: "literal", values: [value] });
    }
    case "array":
      return base({ type: "array", items: itemShape(args[0], scope, depth) });
    case "object":
      return base({
        type: "object",
        fields: parseFields(args[0], scope, depth),
      });
    case "union":
    case "discriminatedUnion":
      return base({ type: "union" });
    default:
      return UNKNOWN;
  }
}

function applyModifier(
  info: TypeInfo,
  method: string,
  args: Node[],
  scope: Scope,
  depth: number,
): TypeInfo {
  switch (method) {
    case "optional":
      return { ...info, required: false };
    case "nullable":
      return { ...info, shape: { ...info.shape, nullable: true } };
    case "nullish":
      return {
        ...info,
        required: false,
        shape: { ...info.shape, nullable: true },
      };
    case "default": {
      const value = literalValue(args[0]);
      return value === undefined
        ? { ...info, required: false }
        : { ...info, required: false, default: value };
    }
    case "url":
    case "email":
      return info.shape.type === "string"
        ? { ...info, shape: { ...info.shape, format: method } }
        : info;
    case "array":
      return base({ type: "array", items: info.shape });
    case "extend":
    case "merge":
      return mergeFields(info, parseExtension(method, args[0], scope, depth));
    case "partial":
      return info.shape.fields
        ? {
            ...info,
            shape: {
              ...info.shape,
              fields: info.shape.fields.map((f) => ({ ...f, required: false })),
            },
          }
        : info;
    default:
      // .min(), .max(), .describe(), .transform(), ... do not change the field's type.
      return info;
  }
}

function parseExtension(
  method: string,
  arg: Node | undefined,
  scope: Scope,
  depth: number,
): readonly SchemaField[] {
  if (arg === undefined) return [];
  if (method === "extend") return parseFields(arg, scope, depth);
  return parseType(arg, scope, depth + 1).shape.fields ?? [];
}

function mergeFields(info: TypeInfo, extra: readonly SchemaField[]): TypeInfo {
  if (!info.shape.fields) return UNKNOWN;
  const names = new Set(extra.map((field) => field.name));
  const fields = [
    ...info.shape.fields.filter((field) => !names.has(field.name)),
    ...extra,
  ];
  return { ...info, shape: { ...info.shape, fields } };
}

function parseFields(
  arg: Node | undefined,
  scope: Scope,
  depth: number,
): SchemaField[] {
  const object = scope.resolve(arg, depth);
  if (object?.type !== "ObjectExpression") return [];

  return object.properties.flatMap((property) => {
    if (property.type !== "ObjectProperty") return [];
    const name = propertyName(property.key);
    if (name === undefined) return [];
    const info = parseType(property.value, scope, depth + 1);
    return [toField(name, info)];
  });
}

function toField(name: string, info: TypeInfo): SchemaField {
  return {
    name,
    ...info.shape,
    required: info.required,
    ...(info.default === undefined ? {} : { default: info.default }),
  };
}

function itemShape(
  arg: Node | undefined,
  scope: Scope,
  depth: number,
): FieldShape {
  return arg === undefined
    ? { type: "unknown" }
    : parseType(arg, scope, depth + 1).shape;
}

function base(shape: FieldShape): TypeInfo {
  return { shape, required: true };
}

// --- AST helpers -------------------------------------------------------------

function unwrap(node: Node | null | undefined): Expression | undefined {
  let current = node;
  while (
    current?.type === "TSAsExpression" ||
    current?.type === "TSSatisfiesExpression" ||
    current?.type === "TSNonNullExpression" ||
    current?.type === "TSTypeAssertion" ||
    current?.type === "ParenthesizedExpression"
  ) {
    current = current.expression;
  }
  return current === null || current === undefined
    ? undefined
    : (current as Expression);
}

function isZod(node: Node): boolean {
  if (node.type === "Identifier") return node.name === "z";
  return (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === "z" &&
    node.property.type === "Identifier" &&
    node.property.name === "coerce"
  );
}

function returnedExpression(body: Node): Node | undefined {
  if (body.type !== "BlockStatement") return body;
  const statement = body.body.find((s) => s.type === "ReturnStatement");
  return statement?.type === "ReturnStatement"
    ? (statement.argument ?? undefined)
    : undefined;
}

function getProperty(object: ObjectExpression, name: string): Node | undefined {
  for (const property of object.properties) {
    if (
      property.type === "ObjectProperty" &&
      propertyName(property.key) === name
    ) {
      return property.value;
    }
  }
  return undefined;
}

function propertyName(key: Node): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  return undefined;
}

function stringValue(node: Node | null | undefined): string | undefined {
  const value = unwrap(node);
  if (value?.type === "StringLiteral") return value.value;
  if (value?.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

function stringList(node: Node | undefined): string[] {
  const value = unwrap(node);
  if (value?.type === "ArrayExpression") {
    return value.elements.flatMap((element) => {
      const text = stringValue(element);
      return text === undefined ? [] : [text];
    });
  }
  const text = stringValue(value);
  return text === undefined ? [] : [text];
}

function literalValue(node: Node | null | undefined): LiteralValue | undefined {
  const value = unwrap(node);
  switch (value?.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return value.value;
    case "NullLiteral":
      return null;
    case "ArrayExpression": {
      const items = value.elements.map((element) => literalValue(element));
      return items.every((item) => item !== undefined) ? items : undefined;
    }
    default:
      return undefined;
  }
}

// --- Paths and patterns ------------------------------------------------------

/** "./src/data/blog/" -> "src/data/blog" */
function normalizePath(path: string): string {
  const trimmed = path.replace(/^\.\//, "").replace(/\/+$/, "");
  return trimmed === "" ? "." : trimmed;
}

/** "**\/*.{md,mdx}" -> ["md", "mdx"]; "*.md" -> ["md"] */
function extensionsOf(pattern: string): string[] {
  const group = /\.\{([^}]+)\}$/.exec(pattern);
  if (group?.[1])
    return group[1].split(",").map((ext) => ext.trim().toLowerCase());
  const single = /\.([A-Za-z0-9]+)$/.exec(pattern);
  return single?.[1] ? [single[1].toLowerCase()] : [];
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
