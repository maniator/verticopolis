import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import lit from "eslint-plugin-lit";
import globals from "globals";

// The rules every linted file shares.
const rules = {
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "prefer-const": "error",
  "no-var": "error",
  "no-nested-ternary": "error",
};

export default [
  {
    ignores: [
      "node_modules",
      "dist",
      "coverage",
      "**/*.config.js",
      "src/public",
      "src/engineBinding/engine.d.ts",
      "help-site",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
    },
    rules,
  },
  {
    // The lit-html templates: the plugin's recommended checks (bindings in
    // valid positions, no duplicate attributes, well-formed template HTML).
    files: ["src/**/*.ts"],
    ...lit.configs["flat/recommended"],
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // The same-origin analytics relay: a Node.js-runtime Vercel Function plus its
    // env-read entry. Same rule set as src, module source.
    files: ["api/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules,
  },
  {
    // Developer scripts and tools run on Node.
    files: ["scripts/**/*.{ts,mts,js,mjs}", "tools/**/*.{ts,mts,js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules,
  },
  {
    // The Playwright specs run on Node, and the callbacks they hand to the
    // page run in the browser, so both sets of globals apply.
    files: ["e2e/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules,
  },
];
