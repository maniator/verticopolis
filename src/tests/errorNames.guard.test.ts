import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { repoRel, sourceFiles } from "./guardFiles";
import { isTestFile } from "./importScan";

/**
 * Every Error subclass the shipped game defines names itself with a string
 * literal, so an error report shows `SaveTooLargeError` rather than a plain
 * `Error` or a minified identifier.
 *
 * Two ways a class loses its name in production: a subclass that never sets
 * `name` inherits `Error.prototype.name` and reports as "Error", and code that
 * reads the class identifier (`constructor.name`) gets whatever the minifier
 * renamed it to. A string literal survives both, which is what the second test
 * below proves on a minified bundle of the real classes.
 *
 * Scope: non-test TypeScript under `src/`, minus the TypeScript reference
 * engine (`src/engine/`, out of the shipped bundle and not edited for features)
 * and the test tree (`src/tests/`, whose helpers never ship).
 */

const SKIPPED_DIRS = ["src/engine/", "src/tests/"] as const;

interface ErrorClass {
  name: string;
  file: string;
  exported: boolean;
  /** The class body, braces included. */
  body: string;
}

/** The `{ ... }` block that opens at `open`, braces included. Brace counting
 *  is enough for these short class bodies, which hold no unbalanced brace in a
 *  string. */
function blockAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** A class declaration that extends something. `export` without `default`
 *  marks a named export, the only kind the minified bundle below can re-export;
 *  nested (indented), abstract and default-exported classes are still found. */
const CLASS_DECL =
  /^[ \t]*(?:(export\s+(?!default\b))|export\s+default\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>{]*>)?\s+extends\s+(\w+)(?:<[^>{]*>)?[^{]*\{/gm;

/** Every class under the scanned roots that extends `Error`, directly or
 *  through another class found here (or a built-in `*Error`). */
function errorClasses(): ErrorClass[] {
  const found: (ErrorClass & { base: string })[] = [];
  for (const abs of sourceFiles("src", [".ts", ".tsx"])) {
    const rel = repoRel(abs);
    if (rel.endsWith(".d.ts") || isTestFile(rel) || SKIPPED_DIRS.some((dir) => rel.startsWith(dir))) continue;
    const text = readFileSync(abs, "utf8");
    for (const m of text.matchAll(CLASS_DECL)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      found.push({ name: m[2], base: m[3], file: abs, exported: !!m[1], body: blockAt(text, open) });
    }
  }
  const errors = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of found) {
      if (errors.has(c.name)) continue;
      if (c.base.endsWith("Error") || errors.has(c.base)) {
        errors.add(c.name);
        grew = true;
      }
    }
  }
  return found.filter((c) => errors.has(c.name));
}

/** True when the class body sets `name` to its own class name as a literal,
 *  either as a field (`override name = "X"`) or in the constructor
 *  (`this.name = "X"`). */
function namesItself(c: ErrorClass): boolean {
  return new RegExp(`\\bname\\s*=\\s*["'\`]${c.name}["'\`]`).test(c.body);
}

describe("error class names", () => {
  const classes = errorClasses();

  it("finds the game's Error subclasses", () => {
    // A scan that matched nothing would pass every check below vacuously.
    expect(classes.map((c) => c.name)).toEqual(
      expect.arrayContaining(["EngineBootError", "EnginePackageError", "SaveTooLargeError", "TowerTooLargeError"]),
    );
  });

  it("every Error subclass sets its name to a string literal of its class name", () => {
    const unnamed = classes.filter((c) => !namesItself(c)).map((c) => `${repoRel(c.file)}: ${c.name}`);
    expect(unnamed, 'add `override name = "<ClassName>";` (or `this.name = "<ClassName>"`)').toEqual([]);
  });

  it("the names survive a minified production-style bundle", async () => {
    const exported = classes.filter((c) => c.exported);
    const entry = exported.map((c) => `export { ${c.name} } from ${JSON.stringify(c.file)};`).join("\n");
    // Vite's production build minifies with esbuild at the `esnext` target and
    // without keepNames (vite.config.ts `build`), so the class identifiers are
    // renamed exactly as they are here.
    const out = await build({
      stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
      bundle: true,
      write: false,
      minify: true,
      keepNames: false,
      target: "esnext",
      format: "iife",
      globalName: "minifiedErrors",
      platform: "browser",
      logLevel: "silent",
    });
    const code = out.outputFiles[0].text;
    const mod = new Function(`${code}; return minifiedErrors;`)() as Record<string, new (...args: unknown[]) => Error>;

    const reported: Record<string, string> = {};
    const identifiers: string[] = [];
    for (const c of exported) {
      const Cls = mod[c.name];
      reported[c.name] = new Cls().name;
      identifiers.push(Cls.name);
    }
    // The bundle really was minified: the class identifiers are gone, so a
    // report that read them would show the mangled names.
    expect(identifiers.filter((id, i) => id === exported[i].name)).toEqual([]);
    expect(reported).toEqual(Object.fromEntries(exported.map((c) => [c.name, c.name])));
  });
});
