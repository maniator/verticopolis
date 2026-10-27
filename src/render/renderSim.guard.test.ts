import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Facade slice 3 (#1210): the renderer reads the simulation through
 * `RenderSim` (`renderSim.ts`), so no `src/render` source names the
 * `Simulation` class or imports its module. A test file may build a real
 * `Simulation` to feed the renderer; the guard covers production sources.
 */

const ROOT = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const SIM_MODULE = /(^|\/)engine\/Simulation(\.[jt]s)?$/;

/** `file:line` of each place in `text` that names `Simulation` through a module
 *  specifier or an import or export name: static and dynamic imports, type
 *  imports (`import("...")`), `import x = require(...)` and re-exports. */
function simulationImports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const hit = (n: ts.Node): void => {
    hits.push(`${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
  };
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const named = ts.isImportDeclaration(n) ? n.importClause?.namedBindings : n.exportClause;
      const namesClass =
        !!named && (ts.isNamedImports(named) || ts.isNamedExports(named)) && named.elements.some((el) => (el.propertyName ?? el.name).text === "Simulation");
      if (SIM_MODULE.test(n.moduleSpecifier.text) || namesClass) hit(n);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const e = n.moduleReference.expression;
      if (ts.isStringLiteral(e) && SIM_MODULE.test(e.text)) hit(n);
    } else if (ts.isImportTypeNode(n)) {
      const lit = ts.isLiteralTypeNode(n.argument) ? n.argument.literal : null;
      if (lit && ts.isStringLiteral(lit) && SIM_MODULE.test(lit.text)) hit(n);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = n.arguments[0];
      if (a && ts.isStringLiteralLike(a) && SIM_MODULE.test(a.text)) hit(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe("the renderer does not name the Simulation", () => {
  it("no production source under src/render imports it", () => {
    const hits = sources(ROOT).flatMap((f) => simulationImports(f, readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the scan finds every import form that names the module or the class", () => {
    const f = join(ROOT, "x.ts");
    const found = (text: string): number => simulationImports(f, text).length;
    expect(found('import type { Simulation } from "../engine/Simulation";')).toBe(1);
    expect(found('import type { HeatmapMode } from "../../engine/Simulation";')).toBe(1);
    expect(found('import type { Simulation as S } from "../engine/sim/types";')).toBe(1);
    expect(found('export type { Simulation } from "../engine/sim/types";')).toBe(1);
    expect(found('export * from "../engine/Simulation";')).toBe(1);
    expect(found('import { Simulation } from "../engine/Simulation.ts";')).toBe(1);
    expect(found('type S = import("../engine/Simulation").Simulation;')).toBe(1);
    expect(found('const m = await import("../engine/Simulation");')).toBe(1);
    expect(found('import S = require("../engine/Simulation");')).toBe(1);
    expect(found('import type { HeatmapMode } from "../engine/sim/constants";')).toBe(0);
  });
});
