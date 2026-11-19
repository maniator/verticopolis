import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * The engine package runs only after the byte check (#985, criterion 5). The
 * check lives in the components package's host (`host/loadEngineModule`); a
 * game module that imports the glue by a computed URL, or calls the unchecked
 * loader, would run files nobody hashed with every other test still green.
 *
 * So: in the game's own sources, an `import()` whose argument is not a string
 * literal may appear only in the files named below, and the host's unchecked
 * loaders (`initEngineGlue` and `compileEngineBinary`) are never named: the
 * game loads the engine only through the host's checked loader.
 */
const isTestFile = (rel: string): boolean => /\.(test|spec|fixture)\.tsx?$/.test(rel);

/** Computed `import()` allowed: the perf tooling that loads a package of its
 *  own choosing in a page it owns. */
const COMPUTED_IMPORT_ALLOWED = new Set([
  "src/tests/perfCompare/page.ts",
  "src/tests/perfCompare/pageSim.ts",
  "src/tests/perfCompare/nodeCheck.ts",
]);

/** The host's unchecked loaders (each fetches or imports the package on its
 *  own), and the game files that may name them: none. */
const UNCHECKED_LOADERS: Record<string, ReadonlySet<string>> = {
  initEngineGlue: new Set(),
  compileEngineBinary: new Set(),
};

function parse(abs: string): ts.SourceFile {
  return ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
}

function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (c) => visit(c, fn));
}

const sources = sourceFiles("src", [".ts", ".tsx"])
  .map((abs) => ({ abs, rel: repoRel(abs) }))
  .filter((f) => !isTestFile(f.rel) && !f.rel.endsWith(".d.ts"));

describe("the engine glue is imported only through the byte check", () => {
  it("scans the source tree", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map((f) => f.rel)).toContain("src/main.ts");
  });

  it("allows an import() of a computed module only in the named files", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const { abs, rel } of sources) {
      visit(parse(abs), (n) => {
        if (!ts.isCallExpression(n) || n.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
        const arg = n.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) return;
        seen.add(rel);
        if (!COMPUTED_IMPORT_ALLOWED.has(rel)) offenders.push(rel);
      });
    }
    expect(offenders, "add the byte check (loadEngineModule) instead of importing the glue by URL").toEqual([]);
    expect([...seen].sort(), "a stale name in COMPUTED_IMPORT_ALLOWED").toEqual([...COMPUTED_IMPORT_ALLOWED].sort());
  });

  it.each(Object.keys(UNCHECKED_LOADERS))("names %s only where it may be", (name) => {
    const callers = new Set<string>();
    for (const { abs, rel } of sources) {
      visit(parse(abs), (n) => {
        // Any mention counts: a call, an import, or a property read off a dynamic import.
        if (ts.isIdentifier(n) && n.text === name) callers.add(rel);
      });
    }
    expect([...callers].filter((r) => !UNCHECKED_LOADERS[name]!.has(r))).toEqual([]);
  });
});
