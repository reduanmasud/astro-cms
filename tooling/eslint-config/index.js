// Shared ESLint flat config for the workspace.
//
// typescript-eslint needs TypeScript's JavaScript compiler API, which
// TypeScript 7 no longer ships. This package therefore depends on TypeScript
// 6.0 privately, while the apps type-check with TypeScript 7.
// See docs/adr/0012-pnpm-workspaces-and-tooling.md.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * @param {{ rootDir: string }} options  Absolute path of the workspace root.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createConfig({ rootDir }) {
  return tseslint.config(
    {
      ignores: [
        "**/dist/**",
        "**/coverage/**",
        "**/data/**",
        ".claude-flow/**",
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: rootDir,
        },
      },
      rules: {
        "@typescript-eslint/consistent-type-imports": "error",
        // Object shapes are interfaces; `type` is for unions, aliases, and utility types.
        "@typescript-eslint/consistent-type-definitions": [
          "error",
          "interface",
        ],
        // Exported functions declare their parameter and return types.
        "@typescript-eslint/explicit-module-boundary-types": "error",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_" },
        ],
      },
    },
    {
      // Plain JS config files are not part of any tsconfig, so skip type-aware rules.
      files: ["**/*.js"],
      ...tseslint.configs.disableTypeChecked,
      rules: {
        ...tseslint.configs.disableTypeChecked.rules,
        // Plain JS cannot carry type annotations; JSDoc documents the types instead.
        "@typescript-eslint/explicit-module-boundary-types": "off",
      },
      languageOptions: {
        ...tseslint.configs.disableTypeChecked.languageOptions,
        globals: globals.node,
      },
    },
    {
      files: ["apps/server/**/*.ts"],
      languageOptions: { globals: globals.node },
    },
    {
      files: ["apps/web/**/*.{ts,tsx}"],
      languageOptions: { globals: globals.browser },
      plugins: {
        "react-hooks": reactHooks,
        "react-refresh": reactRefresh,
      },
      rules: {
        ...reactHooks.configs.recommended.rules,
        "react-refresh/only-export-components": [
          "error",
          { allowConstantExport: true },
        ],
      },
    },
    prettier,
  );
}
