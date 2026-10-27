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

/** `file:line` of each import in `text` that names `Simulation` or loads the module that defines it. */
function simulationImports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const at = (n: ts.Node): string => `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
    const spec = st.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) continue;
    if (/(^|\/)engine\/Simulation$/.test(spec.text)) hits.push(at(st));
    else if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      if (st.importClause.namedBindings.elements.some((el) => (el.propertyName ?? el.name).text === "Simulation")) hits.push(at(st));
    }
  }
  return hits;
}

describe("the renderer does not name the Simulation", () => {
  it("no production source under src/render imports it", () => {
    const hits = sources(ROOT).flatMap((f) => simulationImports(f, readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the scan finds an import of the module and of the class", () => {
    expect(simulationImports(join(ROOT, "x.ts"), 'import type { Simulation } from "../engine/Simulation";')).toHaveLength(1);
    expect(simulationImports(join(ROOT, "x.ts"), 'import type { HeatmapMode } from "../../engine/Simulation";')).toHaveLength(1);
    expect(simulationImports(join(ROOT, "x.ts"), 'import type { Simulation as S } from "../engine/sim/types";')).toHaveLength(1);
    expect(simulationImports(join(ROOT, "x.ts"), 'import type { HeatmapMode } from "../engine/sim/constants";')).toEqual([]);
  });
});
