import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { repoRel, repoRoot, sourceFiles } from "./guardFiles";
import { isTestFile, resolveRelative, scanRuntimeImports } from "./importScan";

/**
 * The tests that still run the TypeScript engine, held to a ratchet.
 *
 * The Rust engine is the one the game runs, and the TypeScript engine goes when
 * `src/engine/` is deleted. A test that builds a `Simulation`, a `Tower` or
 * another engine class directly checks the engine that is leaving, so each one
 * is a file the deletion has to convert (through the port kit,
 * `src/tests/portKit/`, which runs both engines) or retire on evidence. This
 * guard counts them. New tests run the engine through the port instead. Tests
 * inside `src/engine/` are not counted: they leave with the directory.
 *
 * It scans every test file under `src/` outside the engine, plus everything
 * under `src/tests/` (fixtures and helpers included), and pins in
 * `tsEngineTests.ratchet.txt` which of the modules in {@link isEngineClassModule}
 * each file imports at runtime. Catalog, display and data modules are not
 * counted: they are read-only tables the retirement moves on its own schedule
 * (`frontendEngineImports.guard.test.ts` covers the frontend's use of them).
 * Imports are read the way `importScan.ts` reads them, shared with the other
 * import guards. A dynamic `import()` whose specifier is not a string literal
 * is not seen (the perf harness loads WASM glue that way), so a test that
 * reaches the engine through one is a review matter.
 *
 * A runtime import the list does not name fails, and so does a line that names
 * more than its file imports. The list shrinks as tests convert; it grows only
 * with a reason the PR states and a reviewer accepts. When the list is empty,
 * delete it and this guard.
 */
const here = dirname(fileURLToPath(import.meta.url));

/** The engine modules that run a simulation: the classes and the systems under
 *  them, the seeded generator, and the port wrapper that exposes them. */
const ENGINE_CLASS_MODULES: ReadonlySet<string> = new Set([
  "Simulation",
  "Tower",
  "Clock",
  "rng",
  "EventSystem",
  "EconomySystem",
  "ElevatorDispatch",
  "Crowd",
  "Ledger",
  "SimContext",
  "UndoHistory",
  "port/tsEngine",
]);

/** The directories of the engine whose every module is simulation code. */
const ENGINE_CLASS_DIRS = ["sim/", "tower/", "crowd/", "economy/"] as const;

function isEngineClassModule(mod: string): boolean {
  return ENGINE_CLASS_MODULES.has(mod) || ENGINE_CLASS_DIRS.some((dir) => mod.startsWith(dir));
}

/** The engine module a relative specifier names from `rel`, as its path under
 *  `src/engine/` without query or extension, or null for anything else. */
function engineModule(rel: string, spec: string): string | null {
  const target = resolveRelative(rel, spec);
  return target?.startsWith("src/engine/") ? target.slice("src/engine/".length) : null;
}

/** The simulation modules one file imports at runtime, sorted. */
function runtimeEngineClassImports(rel: string, text: string): string[] {
  const { imports } = scanRuntimeImports(rel, text);
  const modules = new Set(imports.map((i) => engineModule(rel, i.spec)).filter((mod): mod is string => mod !== null && isEngineClassModule(mod)));
  return [...modules].sort();
}

/** Every test file the guard scans, repo-relative: tests anywhere under `src/`
 *  outside the engine, and all of `src/tests/`. */
function scannedFiles(): string[] {
  return sourceFiles("src", [".ts", ".tsx"])
    .map(repoRel)
    .filter((rel) => !rel.endsWith(".d.ts") && !rel.startsWith("src/engine/") && (rel.startsWith("src/tests/") || isTestFile(rel)))
    .sort();
}

/** `tsEngineTests.ratchet.txt`: `<file> <module> <module> ...` per line; `#`
 *  starts a comment, on its own line or after the modules. */
function parseRatchet(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [file, ...mods] = line.split(/\s+/);
    if (mods.length === 0) throw new Error(`tsEngineTests.ratchet.txt: "${file}" names no module; delete the line`);
    if (out.has(file)) throw new Error(`tsEngineTests.ratchet.txt: ${file} is listed twice`);
    if (new Set(mods).size !== mods.length) throw new Error(`tsEngineTests.ratchet.txt: ${file} names a module twice`);
    out.set(file, new Set(mods));
  }
  return out;
}

describe("the tests that run the TypeScript engine", () => {
  const files = scannedFiles();
  const scans = new Map(files.map((rel) => [rel, runtimeEngineClassImports(rel, readFileSync(resolve(repoRoot, rel), "utf8"))]));
  const ratchet = parseRatchet(readFileSync(resolve(here, "tsEngineTests.ratchet.txt"), "utf8"));

  it("scans the test tree and leaves out the engine's own tests", () => {
    // A scan that silently found nothing would pass forever.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/tests/portKit/portSim.ts");
    expect(files.some((rel) => rel.startsWith("src/engine/"))).toBe(false);
  });

  it("counts the simulation modules and not the catalog or display tables", () => {
    for (const mod of ["Simulation", "Tower", "Clock", "rng", "Crowd", "port/tsEngine", "sim/loop", "tower/placement", "crowd/walk", "economy/rentalIncome"]) {
      expect(isEngineClassModule(mod), mod).toBe(true);
    }
    for (const mod of ["facilities", "milestones", "types", "gameRules", "catalog", "port/commands", "calendar", "serializedGame"]) {
      expect(isEngineClassModule(mod), mod).toBe(false);
    }
  });

  it("reads imports the way the other import guards do", () => {
    const sample = [
      'import type { Simulation } from "../engine/Simulation";',
      'import { FACILITIES } from "../engine/facilities";',
      'import { Tower } from "../engine/Tower";',
      'import { Simulation } from "../engine/Simulation.ts";',
      'import { TsEngine } from "../engine/port/tsEngine";',
      'const load = () => import("../engine/sim/serialization");',
    ].join("\n");
    expect(runtimeEngineClassImports("src/tests/sample.test.ts", sample)).toEqual(["Simulation", "Tower", "port/tsEngine", "sim/serialization"]);
    expect(runtimeEngineClassImports("src/engine/sample.test.ts", 'import { Tower } from "./Tower";')).toEqual(["Tower"]);
  });

  it("no test imports a simulation module at runtime that the ratchet does not name", () => {
    const grown: string[] = [];
    for (const [rel, modules] of scans) {
      const allowed = ratchet.get(rel) ?? new Set<string>();
      for (const mod of modules) if (!allowed.has(mod)) grown.push(`${rel}: ${mod}`);
    }
    expect(
      grown,
      "New tests run the engine through the port kit (src/tests/portKit/) instead of the TypeScript classes (see this guard's comment). " +
        "If the names are types, import them with `import type`. A runtime import that cannot wait goes in " +
        `tsEngineTests.ratchet.txt, with a # reason on its line and in the PR:\n${grown.join("\n")}`,
    ).toEqual([]);
  });

  it("the ratchet has no stale entries", () => {
    const stale: string[] = [];
    for (const [rel, allowed] of ratchet) {
      const mods = new Set(scans.get(rel) ?? []);
      for (const mod of allowed) if (!mods.has(mod)) stale.push(`${rel}: ${mod}`);
    }
    expect(stale, `Delete these from tsEngineTests.ratchet.txt (a file's line goes when it names nothing):\n${stale.join("\n")}`).toEqual([]);
  });

  it("refuses a ratchet line it cannot read", () => {
    expect(() => parseRatchet("src/tests/a.test.ts")).toThrow(/names no module/);
    expect(() => parseRatchet("src/tests/a.test.ts # only a reason")).toThrow(/names no module/);
    expect(() => parseRatchet("src/tests/a.test.ts Tower\nsrc/tests/a.test.ts Clock")).toThrow(/listed twice/);
    expect(() => parseRatchet("src/tests/a.test.ts Tower Tower")).toThrow(/names a module twice/);
    expect(parseRatchet("# a comment\n\nsrc/tests/a.test.ts Tower Clock # why it stays\r\n")).toEqual(new Map([["src/tests/a.test.ts", new Set(["Tower", "Clock"])]]));
  });
});
