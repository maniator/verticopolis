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
 * cannot tell). A dynamic `import()` whose module is not a string literal is
 * reported as unreadable, since no guard can tell what it loads.
 */

/** How a runtime import loads its module. `static` joins the importer's
 *  chunk; the others load it separately (a dynamic `import()`, a worker or
 *  asset URL, a glob of lazy imports). */
export type ImportKind = "static" | "dynamic" | "url" | "glob";

export interface RuntimeImport {
  spec: string;
  kind: ImportKind;
}

export interface ImportScan {
  imports: RuntimeImport[];
  /** `file:line` of each dynamic `import()` the scan cannot read. */
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

/** Every runtime import in one file, in source order, with its module
 *  specifier as written. */
export function scanRuntimeImports(rel: string, text: string): ImportScan {
  const imports: RuntimeImport[] = [];
  const unreadable: string[] = [];
  const note = (spec: ts.Expression | undefined, kind: ImportKind): void => {
    if (spec !== undefined && ts.isStringLiteralLike(spec)) imports.push({ spec: spec.text, kind });
  };
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!importIsTypeOnly(node.importClause)) note(node.moduleSpecifier, "static");
    } else if (ts.isExportDeclaration(node)) {
      if (!exportIsTypeOnly(node)) note(node.moduleSpecifier, "static");
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!node.isTypeOnly) note(node.moduleReference.expression, "static");
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteralLike(arg)) note(arg, "dynamic");
      else unreadable.push(`${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "glob" && isImportMeta(node.expression.expression)) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isArrayLiteralExpression(arg)) arg.elements.forEach((e) => note(e, "glob"));
      else note(arg, "glob");
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const base = node.arguments?.[1];
      if (base !== undefined && ts.isPropertyAccessExpression(base) && isImportMeta(base.expression)) note(node.arguments?.[0], "url");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, unreadable };
}

/** The repo-relative path a relative specifier names from `rel`, without
 *  its query or extension and without a trailing slash, or null for a bare
 *  package specifier. */
export function resolveRelative(rel: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return posix
    .normalize(posix.join(posix.dirname(rel), spec.replace(/\?.*$/, "")))
    .replace(/\/$/, "")
    .replace(/\.(d\.ts|tsx?|mts|jsx?|mjs)$/, "");
}

/** Test files and fixtures, which no guard of the shipped code scans. */
export const isTestFile = (rel: string): boolean => /\.(test|spec|fixture)\.tsx?$/.test(rel);
