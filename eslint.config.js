import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import lit from "eslint-plugin-lit";
import globals from "globals";
import { existsSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The rules every linted file shares.
const rules = {
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "prefer-const": "error",
  "no-var": "error",
  "no-nested-ternary": "error",
};

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "src");

/**
 * src/ imports no TypeScript from outside src/, also through a .js specifier
 * that resolves to a .ts file or a `typeof import(…)`. The game's typecheck
 * covers src/ only, so a .ts file outside it would join the program unchecked
 * by its own config; the help site's .mjs modules (typed by their JSDoc,
 * checked by the help site's astro check), JSON and `?raw` Markdown stay
 * allowed. Shared code the unit tests pin lives under src/tests
 * (screenshotOnlyFilter.ts).
 */
const srcBoundary = {
  meta: {
    type: "problem",
    schema: [],
    messages: { outside: "src/ imports no TypeScript from outside src/: {{spec}}" },
  },
  create(context) {
    const check = (node) => {
      const spec = node?.type === "Literal" ? node.value : null;
      if (typeof spec !== "string" || !spec.startsWith(".")) return;
      const path = spec.split("?")[0];
      const target = resolve(dirname(context.filename), path);
      if (!relative(SRC, target).startsWith("..")) return;
      const ext = extname(path);
      // A .js specifier can resolve to its .ts twin under "bundler" resolution.
      const twins = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] }[ext] ?? [];
      const twin = twins.some((e) => existsSync(target.slice(0, -ext.length) + e));
      if (ext === "" || /^\.[cm]?tsx?$/.test(ext) || twin)
        context.report({ node, messageId: "outside", data: { spec } });
    };
    return {
      ImportDeclaration: (n) => check(n.source),
      ExportNamedDeclaration: (n) => check(n.source),
      ExportAllDeclaration: (n) => check(n.source),
      ImportExpression: (n) => check(n.source),
      // `typeof import("…")` in a type position.
      TSImportType: (n) => check(n.source ?? n.argument?.literal),
    };
  },
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
    plugins: { local: { rules: { "src-boundary": srcBoundary } } },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
    },
    rules: { ...rules, "local/src-boundary": "error" },
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
