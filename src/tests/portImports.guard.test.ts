import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Story facade 7, AC 2, over the port (contract migration row 2): the game's
 * side of the port, `EnginePort` and the shared reader, reaches no
 * TypeScript `Simulation`, `Tower` or `Crowd` at runtime. The guard walks the
 * static and dynamic imports from each root and fails on a runtime edge into
 * the simulation's modules; a type-only import is no edge, since it leaves
 * no code behind. PR 5 adds the boot path's root.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

const ROOTS = ["src/simport/enginePort.ts", "src/simport/viewReader.ts", "src/simport/portCodes.ts"];

/** The modules the TypeScript engine runs on. */
const SIMULATION = [/^src\/engine\/sim\//, /^src\/engine\/Simulation\.ts$/, /^src\/engine\/Tower\.ts$/, /^src\/engine\/crowd\//];

/** Each runtime import specifier in `text`: static imports and re-exports
 *  that are not type-only, side-effect imports, and dynamic `import()`. */
function runtimeImports(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const from = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gm;
  for (const m of code.matchAll(from)) {
    if (m[2]) continue;
    const braces = /^\{([^}]*)\}$/.exec(m[3].trim());
    const allTypes = braces !== null && braces[1].split(",").every((s) => s.trim() === "" || /^type\s/.test(s.trim()));
    if (!allTypes) out.push(m[4]);
  }
  for (const m of code.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

/** The repo file a relative specifier names, or undefined for a package. */
function resolveImport(from: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = resolve(root, dirname(from), spec);
  for (const f of [base, `${base}.ts`, resolve(base, "index.ts"), base.replace(/\.js$/, ".ts")]) {
    if (existsSync(f) && f.endsWith(".ts")) return relative(root, f).split("\\").join("/");
  }
  if (existsSync(base)) return relative(root, base).split("\\").join("/");
  return undefined;
}

/** Every runtime path from `start` into the simulation, as import chains. */
function reachesSimulation(start: string): string[] {
  const seen = new Set<string>([start]);
  const queue: string[][] = [[start]];
  const hits: string[] = [];
  while (queue.length > 0) {
    const chain = queue.shift()!;
    const file = chain[chain.length - 1];
    if (!file.endsWith(".ts")) continue;
    for (const spec of runtimeImports(readFileSync(resolve(root, file), "utf8"))) {
      const next = resolveImport(file, spec);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      if (SIMULATION.some((re) => re.test(next))) hits.push([...chain, next].join(" -> "));
      else queue.push([...chain, next]);
    }
  }
  return hits;
}

describe("the port's side of the game imports no TypeScript simulation", () => {
  for (const start of ROOTS) {
    it(`${start} reaches no Simulation, Tower or Crowd at runtime`, () => {
      expect(reachesSimulation(start)).toEqual([]);
    });
  }

  it("finds an edge where one exists", () => {
    // The TypeScript engine runs on the simulation, so the walk must see it.
    expect(reachesSimulation("src/engine/port/tsEngine.ts").length).toBeGreaterThan(0);
  });

  it("reads type-only imports as no edge", () => {
    const text = [
      'import type { Simulation } from "../engine/Simulation";',
      'import { type Tower } from "../engine/Tower";',
      'import { VIEW } from "./view";',
      'export { thing } from "./thing";',
      'const m = await import("./lazy");',
    ].join("\n");
    expect(runtimeImports(text)).toEqual(["./view", "./thing", "./lazy"]);
  });
});
