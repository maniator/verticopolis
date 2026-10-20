import { posix } from "node:path";
import ts from "typescript";

/**
 * How the import guards read a source file's imports, shared so they count
 * the same way (`frontendEngineImports.guard.test.ts`, #1118, and
 * `simulationReach.guard.test.ts`, the facade's slice 1).
 *
 * An import counts the way the TypeScript engine's retirement inventory counts
 * it: it is type-only when it says `import type` or `export type`, or marks
 * every name it brings in with `type`, and anything else is a runtime import,
 * including a bare `import "..."`, a dynamic `import()`, `new URL("...",
 * import.meta.url)` and `import.meta.glob`. A name used only as a type but
 * imported without `type` counts as runtime (the build drops it, the guard
 * cannot tell). A dynamic `import()`, a worker or asset URL or a glob whose
 * module is not a string literal is reported as unreadable, since no guard
 * can tell what it loads. Vite's `?raw`, `?url` and `?inline` imports load a
 * file's text or address and never run it, so they are not imports here; a
 * `?worker` import (with `&url` or `&inline` too) starts the module in its
 * own chunk, as a worker URL does. A glob pattern keeps its call's `!`
 * patterns beside it.
 */

/** How a runtime import loads its module. `static` joins the importer's
 *  chunk; the others load it separately (a dynamic `import()`, a worker or
 *  asset URL, a glob of lazy imports). An eager glob is `static`. */
export type ImportKind = "static" | "dynamic" | "url" | "glob";

export interface RuntimeImport {
  spec: string;
  kind: ImportKind;
  /** Set for an `import.meta.glob` pattern: the same call's `!` patterns,
   *  which take matches out of this pattern only. */
  glob?: { exclude: string[] };
}

export interface ImportScan {
  imports: RuntimeImport[];
  /** `file:line` of each `import()`, worker or asset URL or glob whose module
   *  the scan cannot read. */
  unreadable: string[];
}

/** True when an import brings in types only. */
function importIsTypeOnly(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false; // `import "../engine/x"` runs the module
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  return !clause.name && named !== undefined && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
}

/** True when a re-export brings in types only. */
function exportIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly);
}

/** `import.meta` in `import.meta.url` or `import.meta.glob`. */
const isImportMeta = (node: ts.Node): boolean => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword;

/** True for `{ eager: true }`, the glob option that bundles every match into
 *  the importer's chunk. */
function isEager(options: ts.Expression | undefined): boolean {
  return (
    options !== undefined &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.some((p) => ts.isPropertyAssignment(p) && p.name.getText() === "eager" && p.initializer.kind === ts.SyntaxKind.TrueKeyword)
  );
}

/** The Vite query a specifier carries, without its `?`, or "". */
const viteQuery = (spec: string): string => /\?([^#]*)/.exec(spec)?.[1] ?? "";

/** Every runtime import in one file, in source order, with its module
 *  specifier as written (a URL's relative path given its `./`). */
export function scanRuntimeImports(rel: string, text: string): ImportScan {
  const imports: RuntimeImport[] = [];
  const unreadable: string[] = [];
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const lineOf = (node: ts.Node): string => `${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const note = (spec: ts.Expression | undefined, kind: ImportKind, at: ts.Node): void => {
    if (spec === undefined || !ts.isStringLiteralLike(spec)) {
      unreadable.push(lineOf(at));
      return;
    }
    const query = viteQuery(spec.text).split("&");
    // A worker import runs the module in its own chunk, whether it hands
    // back the constructor, the worker's URL (`?worker&url`) or an inline
    // worker (`?worker&inline`); otherwise these queries load text or an
    // address and run nothing.
    if (query.some((q) => q === "worker" || q === "sharedworker")) imports.push({ spec: spec.text, kind: "url" });
    else if (!query.some((q) => q === "raw" || q === "url" || q === "inline")) imports.push({ spec: spec.text, kind });
  };
  const noteGlob = (patterns: ts.Expression | undefined, kind: ImportKind, at: ts.Node): void => {
    const list = patterns !== undefined && ts.isArrayLiteralExpression(patterns) ? [...patterns.elements] : [patterns];
    if (!list.every((p): p is ts.StringLiteralLike => p !== undefined && ts.isStringLiteralLike(p))) {
      unreadable.push(lineOf(at));
      return;
    }
    const exclude = list.filter((p) => p.text.startsWith("!")).map((p) => p.text);
    for (const p of list) if (!p.text.startsWith("!")) imports.push({ spec: p.text, kind, glob: { exclude } });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!importIsTypeOnly(node.importClause)) note(node.moduleSpecifier, "static", node);
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && !exportIsTypeOnly(node)) note(node.moduleSpecifier, "static", node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!node.isTypeOnly) note(node.moduleReference.expression, "static", node);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      note(node.arguments[0], "dynamic", node);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "glob" && isImportMeta(node.expression.expression)) {
      const [patterns, options] = node.arguments;
      noteGlob(patterns, isEager(options) ? "static" : "glob", node);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const [spec, base] = node.arguments ?? [];
      if (base !== undefined && ts.isPropertyAccessExpression(base) && isImportMeta(base.expression)) {
        // `new URL("x.ts", import.meta.url)` is relative to the file, `./` or not.
        const relative = spec !== undefined && ts.isStringLiteralLike(spec) && !/^([a-z][a-z0-9+.-]*:|\.|\/)/i.test(spec.text);
        if (relative) imports.push({ spec: `./${spec.text}`, kind: "url" });
        else note(spec, "url", node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, unreadable };
}

/** Vite serves `src/` as its root, so `/x` in a specifier is `src/x`. */
const VITE_ROOT = "src";

/** The repo-relative path a relative or root-absolute specifier names from
 *  `rel`, with its query, hash and extension dropped and without a trailing
 *  slash, or null for a bare package specifier or a scheme URL. */
export function resolveRelative(rel: string, spec: string): string | null {
  const path = spec.replace(/[?#].*$/, "");
  let joined: string;
  if (path.startsWith(".")) joined = posix.join(posix.dirname(rel), path);
  else if (path.startsWith("/") && !path.startsWith("//")) joined = posix.join(VITE_ROOT, path);
  else return null;
  return posix
    .normalize(joined)
    .replace(/\/$/, "")
    .replace(/\.(d\.ts|tsx?|mts|jsx?|mjs)$/, "");
}

/** The repo-relative glob a glob specifier names from `rel` (its `!` kept in
 *  front), or null for one that is not relative or root-absolute. A glob's
 *  `?` is a wildcard, so nothing is cut. */
export function resolveGlob(rel: string, spec: string): string | null {
  const negated = spec.startsWith("!");
  const path = negated ? spec.slice(1) : spec;
  let joined: string;
  if (path.startsWith(".")) joined = posix.join(posix.dirname(rel), path);
  else if (path.startsWith("/") && !path.startsWith("//")) joined = posix.join(VITE_ROOT, path);
  else return null;
  return (negated ? "!" : "") + posix.normalize(joined);
}

/** A regular expression for one glob: `**` spans directories, `*` and `?`
 *  stay within one, `{a,b}` is a choice and `[...]` a class. */
export function globRegex(glob: string): RegExp {
  const escape = (ch: string): string => ch.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
  const body = (pattern: string): string => {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "*" && pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:[^/]*/)*";
        } else out += ".*";
      } else if (ch === "*") out += "[^/]*";
      else if (ch === "?") out += "[^/]";
      else if (ch === "{" && pattern.indexOf("}", i) > i) {
        const end = pattern.indexOf("}", i);
        out += `(?:${pattern.slice(i + 1, end).split(",").map(body).join("|")})`;
        i = end;
      } else if (ch === "[" && pattern.indexOf("]", i) > i + 1) {
        const end = pattern.indexOf("]", i);
        out += `[${pattern.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      } else out += escape(ch);
    }
    return out;
  };
  return new RegExp(`^${body(glob)}$`);
}

/** Test files and fixtures, which no guard of the shipped code scans. */
export const isTestFile = (rel: string): boolean => /\.(test|spec|fixture)\.tsx?$/.test(rel);
