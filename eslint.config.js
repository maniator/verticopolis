import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * The shipped game runs the Rust engine only, so no shipped file may import
 * the TypeScript engine (`src/engine/`) at runtime (#921 part 2c). Types stay
 * importable with `import type`. The rule names the engine by relative path,
 * so there is one block per source depth (`src/x.ts` says `./engine`,
 * `src/a/x.ts` says `../engine`, and so on), and a path that only ends in
 * `engine` (the binding declaration, `src/dualrun/engine.d.ts`) is left alone.
 * `src/tests/frontendEngineImports.guard.test.ts` also catches what an import
 * rule cannot see (a dynamic `import()`, a URL, a glob), and
 * `scripts/verify-engine-bundle.ts` proves the emitted bundle.
 *
 * Not shipped, so not held to it: the engine itself, tests and their fixtures,
 * the tooling build's hand-built tower (`src/game/toolingSim.ts`, swapped out
 * of production builds by `vite.config.ts`), and the atlas bake's two halves,
 * which run in `scripts/` tooling and never reach `dist/`.
 */
const TS_ENGINE_EXEMPT = [
  "src/engine/**",
  "src/tests/**",
  "src/**/*.test.ts",
  "src/**/*.fixture.ts",
  "src/game/toolingSim.ts",
  "src/render/atlas/archive.ts",
  "src/render/atlas/browserEntry.ts",
];

function noTypeScriptEngine(depth) {
  const up = depth === 0 ? "./" : "../".repeat(depth);
  return {
    files: [`src/${"*/".repeat(depth)}*.ts`],
    ignores: TS_ENGINE_EXEMPT,
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [`${up}engine`, `${up}engine/**`, "/engine", "/engine/**"],
              allowTypeImports: true,
              message:
                "The shipped game runs the Rust engine only (#921): read the tower catalog (src/catalog/), the frame view or an engine query instead of the TypeScript engine. Types may still come from it with `import type`.",
            },
          ],
        },
      ],
    },
  };
}

export default [
  {
    ignores: ["node_modules", "dist", "coverage", "scripts", "**/*.config.js", "src/public", "src/dualrun/engine.d.ts"],
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
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "prefer-const": "error",
      "no-var": "error",
      "no-nested-ternary": "error",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  ...[0, 1, 2, 3, 4, 5].map(noTypeScriptEngine),
  {
    // The same-origin analytics relay: a Node.js-runtime Vercel Function plus its
    // env-read entry. Same rule set as src, module source.
    files: ["api/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "prefer-const": "error",
      "no-var": "error",
      "no-nested-ternary": "error",
    },
  },
];
