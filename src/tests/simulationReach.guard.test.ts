import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DUAL_RUN } from "../build/engineBundle";
import { repoRel, repoRoot, sourceFiles } from "./guardFiles";
import { isTestFile, resolveRelative, scanRuntimeImports, type ImportKind } from "./importScan";

/**
 * Who still reaches the TypeScript `Simulation`, held to a ratchet.
 *
 * The facade (AD-9, #1207) takes the TypeScript `Simulation` off the healthy
 * WASM path: the page talks to a `SimPort` (`src/simport/`), and the
 * TypeScript engine runs only as the fallback. Each production file that
 * imports `Simulation` at runtime, directly or through an engine module that
 * does, is one more place that path still needs it, so this guard pins those
 * files in `simulationReach.ratchet.txt` and fails on a new one.
 *
 * It reads every non-test file under `src/`, the engine, the host and the
 * save code included, with the counting rules of `importScan.ts` (the same as
 * the frontend engine-import guard: type-only imports do not count, a bare
 * import, a re-export, `import()`, a worker or asset URL and
 * `import.meta.glob` do). The reach set is every engine module whose static
 * runtime imports lead to `src/engine/Simulation.ts`. An edge into that set
 * from a file outside `src/engine/` is a crossing, and the ratchet names each
 * crossing file with the modules it imports, and a reason. A file that reaches
 * `Simulation` only through another non-engine file is not listed: its
 * crossing is that other file's. A crossing by `import()`, URL or glob fails
 * outright, since a lazy edge into the set is how the adapter that hosts the
 * fallback will load it, and that adapter is the one exception a later slice
 * adds. The dual run's files (`DUAL_RUN` in `src/build/engineBundle.ts`,
 * which a player build may not carry) are exempt.
 *
 * The list shrinks as slices 2 to 11 move consumers behind the port; it grows
 * only with a reason the PR states and a reviewer accepts.
 */
const here = dirname(fileURLToPath(import.meta.url));

const SIMULATION = "src/engine/Simulation.ts";
const ENGINE_DIR = "src/engine/";
const isEngine = (rel: string): boolean => rel.startsWith(ENGINE_DIR);

/** Files that may cross into the reach set without a ratchet line. */
const EXEMPT: ReadonlySet<string> = new Set(DUAL_RUN);

/** Files whose `import()` loads the engine package's glue by URL, a file
 *  outside `src/` that no TypeScript source reaches through. */
const PACKAGE_LOADERS: ReadonlySet<string> = new Set(["src/wasmhost/engineLoad.ts"]);

interface Edge {
  from: string;
  to: string;
  kind: ImportKind;
}

interface Graph {
  edges: Edge[];
  /** `file:line` of each `import()` whose module the scan cannot read. */
  unreadable: string[];
}

/** The engine module a file is, as its path under `src/engine/` without the
 *  extension (`Simulation`, `sim/loop`). */
const engineModule = (rel: string): string => rel.slice(ENGINE_DIR.length).replace(/\.tsx?$/, "");

/** The source files a specifier loads, among `files`: one file for an
 *  import or URL, every match for a glob, none for a package. */
function targets(files: ReadonlySet<string>, rel: string, spec: string, kind: ImportKind): string[] {
  const base = resolveRelative(rel, spec);
  if (base === null) return [];
  if (kind === "glob") {
    const pattern = new RegExp(`^${base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(?:.*/)?").replace(/\*/g, "[^/]*")}\\.tsx?$`);
    return [...files].filter((f) => pattern.test(f));
  }
  const hit = [".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext).find((f) => files.has(f));
  return hit === undefined ? [] : [hit];
}

/** The runtime import graph of `sources` (repo-relative path to text). */
function buildGraph(sources: ReadonlyMap<string, string>): Graph {
  const files = new Set(sources.keys());
  const edges: Edge[] = [];
  const unreadable: string[] = [];
  for (const [rel, text] of sources) {
    const scan = scanRuntimeImports(rel, text);
    unreadable.push(...scan.unreadable);
    for (const { spec, kind } of scan.imports) for (const to of targets(files, rel, spec, kind)) edges.push({ from: rel, to, kind });
  }
  return { edges, unreadable };
}

/** The engine files whose static runtime imports lead to `SIMULATION`. */
function reachSet(graph: Graph): Set<string> {
  const importers = new Map<string, string[]>();
  for (const { from, to, kind } of graph.edges) if (kind === "static") importers.set(to, [...(importers.get(to) ?? []), from]);
  const reached = new Set([SIMULATION]);
  const queue = [SIMULATION];
  for (let i = 0; i < queue.length; i++) {
    for (const from of importers.get(queue[i]) ?? []) {
      if (reached.has(from)) continue;
      reached.add(from);
      queue.push(from);
    }
  }
  return new Set([...reached].filter(isEngine));
}

/** The crossings into `reach`: each non-engine file's static targets as
 *  engine modules, sorted, and every lazy crossing as `from -> module (kind)`. */
function crossings(graph: Graph, reach: ReadonlySet<string>): { pinned: Map<string, string[]>; lazy: string[] } {
  const pinned = new Map<string, Set<string>>();
  const lazy: string[] = [];
  for (const { from, to, kind } of graph.edges) {
    if (isEngine(from) || EXEMPT.has(from) || !reach.has(to)) continue;
    if (kind !== "static") lazy.push(`${from} -> ${engineModule(to)} (${kind})`);
    else pinned.set(from, (pinned.get(from) ?? new Set()).add(engineModule(to)));
  }
  return { pinned: new Map([...pinned].map(([rel, mods]) => [rel, [...mods].sort()])), lazy: lazy.sort() };
}

/** `simulationReach.ratchet.txt`: `<file> <module> ... # reason` per line,
 *  the reason required; a line that is only a comment is ignored. */
function parseRatchet(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const hash = raw.indexOf("#");
    const [file, ...mods] = (hash < 0 ? raw : raw.slice(0, hash)).trim().split(/\s+/);
    if (mods.length === 0) throw new Error(`simulationReach.ratchet.txt: "${file}" names no module; delete the line`);
    if (hash < 0 || raw.slice(hash + 1).trim() === "") throw new Error(`simulationReach.ratchet.txt: ${file} gives no # reason`);
    if (out.has(file)) throw new Error(`simulationReach.ratchet.txt: ${file} is listed twice`);
    if (new Set(mods).size !== mods.length) throw new Error(`simulationReach.ratchet.txt: ${file} names a module twice`);
    out.set(file, new Set(mods));
  }
  return out;
}

/** Ratchet lines `pinned` has that `ratchet` lacks, and the reverse. */
function compare(pinned: ReadonlyMap<string, readonly string[]>, ratchet: ReadonlyMap<string, ReadonlySet<string>>): { grown: string[]; stale: string[] } {
  const grown: string[] = [];
  const stale: string[] = [];
  for (const [rel, mods] of pinned) for (const mod of mods) if (!ratchet.get(rel)?.has(mod)) grown.push(`${rel}: ${mod}`);
  for (const [rel, mods] of ratchet) for (const mod of mods) if (!pinned.get(rel)?.includes(mod)) stale.push(`${rel}: ${mod}`);
  return { grown, stale };
}

/** Every non-test source file under `src/`, outside the test tree. */
function productionFiles(): string[] {
  return sourceFiles("src", [".ts", ".tsx"])
    .map(repoRel)
    .filter((rel) => !rel.endsWith(".d.ts") && !isTestFile(rel) && !rel.startsWith("src/tests/") && !rel.includes("/__mocks__/"))
    .sort();
}

describe("the files that reach the TypeScript Simulation", () => {
  const files = productionFiles();
  const graph = buildGraph(new Map(files.map((rel) => [rel, readFileSync(resolve(repoRoot, rel), "utf8")])));
  const reach = reachSet(graph);
  const { pinned, lazy } = crossings(graph, reach);
  const ratchet = parseRatchet(readFileSync(resolve(here, "simulationReach.ratchet.txt"), "utf8"));

  it("scans all of src/, the engine, host and save code included, and leaves out the tests", () => {
    // A scan that silently found nothing would pass forever.
    expect(files.length).toBeGreaterThan(300);
    for (const rel of [SIMULATION, "src/main.ts", "src/storage/SaveGame.ts", "src/wasmhost/wasmHost.ts", "src/dualrun/dualRun.ts", "src/simport/tsSim.ts"]) expect(files).toContain(rel);
    expect(files.some((rel) => rel.startsWith("src/tests/") || isTestFile(rel))).toBe(false);
    expect(graph.edges.length).toBeGreaterThan(1000);
  });

  it("finds the engine modules that lead to Simulation", () => {
    expect(reach.has(SIMULATION)).toBe(true);
    expect([...reach].every(isEngine)).toBe(true);
    // The step loop imports it; if this fails the engine moved, and the
    // ratchet's lines may need their module names updated.
    expect(reach.has("src/engine/sim/loop.ts"), [...reach].sort().join("\n")).toBe(true);
  });

  it("exempts only the dual run, by the build guard's own list", () => {
    expect(DUAL_RUN.length).toBeGreaterThan(0);
    for (const rel of DUAL_RUN) expect(existsSync(resolve(repoRoot, rel)), rel).toBe(true);
  });

  it("every dynamic import under src/ names its module, except the engine package's loader", () => {
    const fileOf = (at: string): string => at.replace(/:\d+$/, "");
    const unread = graph.unreadable.filter((at) => !EXEMPT.has(fileOf(at)) && !PACKAGE_LOADERS.has(fileOf(at)));
    expect(unread, `The guard cannot tell what these import; give import() a string literal:\n${unread.join("\n")}`).toEqual([]);
    for (const rel of PACKAGE_LOADERS) expect(graph.unreadable.some((at) => fileOf(at) === rel), `${rel} no longer loads the package by URL; drop it from PACKAGE_LOADERS`).toBe(true);
  });

  it("nothing outside the engine loads Simulation lazily", () => {
    expect(lazy, "A lazy edge into the Simulation reach set is reserved for the adapter that hosts the fallback (facade slice 8 or 10):\n" + lazy.join("\n")).toEqual([]);
  });

  it("no file imports Simulation at runtime that the ratchet does not name", () => {
    const { grown } = compare(pinned, ratchet);
    expect(
      grown,
      "New code reads the port (src/simport/) instead of the TypeScript Simulation; import its types with `import type`. " +
        `A runtime import that cannot wait goes in simulationReach.ratchet.txt with a # reason, and the PR says why:\n${grown.join("\n")}`,
    ).toEqual([]);
  });

  it("the ratchet has no stale entries", () => {
    const { stale } = compare(pinned, ratchet);
    expect(stale, `Delete these from simulationReach.ratchet.txt (a file's line goes when it names nothing):\n${stale.join("\n")}`).toEqual([]);
  });

  it("refuses a ratchet line it cannot read", () => {
    expect(() => parseRatchet("src/main.ts # why")).toThrow(/names no module/);
    expect(() => parseRatchet("src/main.ts Simulation")).toThrow(/no # reason/);
    expect(() => parseRatchet("src/main.ts Simulation #  ")).toThrow(/no # reason/);
    expect(() => parseRatchet("src/main.ts Simulation # a\nsrc/main.ts sim/loop # b")).toThrow(/listed twice/);
    expect(() => parseRatchet("src/main.ts Simulation Simulation # a")).toThrow(/names a module twice/);
    expect(parseRatchet("# a comment\n\nsrc/main.ts Simulation sim/loop # why it stays\r\n")).toEqual(new Map([["src/main.ts", new Set(["Simulation", "sim/loop"])]]));
  });
});

describe("the reach guard on a synthetic tree", () => {
  const tree = (extra: Record<string, string> = {}) => {
    const graph = buildGraph(
      new Map(
        Object.entries({
          [SIMULATION]: 'import { tick } from "./sim/loop";\nexport class Simulation {}',
          "src/engine/sim/loop.ts": "export const tick = 1;",
          "src/engine/sim/save.ts": 'import { Simulation } from "../Simulation";\nexport const save = Simulation;',
          "src/engine/types.ts": "export const KINDS = [];",
          "src/engine/index.ts": 'export * from "./types";',
          "src/game/helper.ts": 'import { Simulation } from "../engine/Simulation";\nexport const h = Simulation;',
          "src/ui/panel.ts": 'import { h } from "../game/helper";\nimport { KINDS } from "../engine";',
          "src/ui/typed.ts": 'import type { Simulation } from "../engine/Simulation";\nimport { type Simulation as S } from "../engine/Simulation.ts";',
          ...extra,
        }),
      ),
    );
    const reach = reachSet(graph);
    return { reach, ...crossings(graph, reach) };
  };

  it("counts a chain through a non-engine helper at its crossing edge only", () => {
    const { reach, pinned, lazy } = tree();
    expect([...reach].sort()).toEqual([SIMULATION, "src/engine/sim/save.ts"]);
    expect(pinned).toEqual(new Map([["src/game/helper.ts", ["Simulation"]]]));
    expect(lazy).toEqual([]);
  });

  it("does not count a type-only import", () => {
    expect(tree().pinned.has("src/ui/typed.ts")).toBe(false);
  });

  it("reports a dynamic import, a URL and a glob into the set as lazy edges", () => {
    const { pinned, lazy } = tree({
      "src/ui/later.ts": 'export const load = () => import("../engine/Simulation");',
      "src/ui/worker.ts": 'export const w = new URL("../engine/sim/save.ts?worker", import.meta.url);',
      "src/ui/all.ts": 'export const all = import.meta.glob("../engine/sim/*.ts");',
    });
    expect(pinned.has("src/ui/later.ts")).toBe(false);
    expect(lazy).toEqual(["src/ui/all.ts -> sim/save (glob)", "src/ui/later.ts -> Simulation (dynamic)", "src/ui/worker.ts -> sim/save (url)"]);
  });

  it("turns an engine module that starts importing Simulation into new lines for its importers", () => {
    const { reach, pinned } = tree({ "src/engine/types.ts": 'import "./sim/save";\nexport const KINDS = [];' });
    expect(reach.has("src/engine/index.ts")).toBe(true);
    expect(pinned.get("src/ui/panel.ts")).toEqual(["index"]);
  });

  it("leaves the dual run out", () => {
    const [dual] = DUAL_RUN;
    const { pinned, lazy } = tree({ [dual]: 'import { Simulation } from "../engine/Simulation";\nconst l = () => import("../engine/sim/save");' });
    expect(pinned.has(dual)).toBe(false);
    expect(lazy).toEqual([]);
  });

  it("compares lines both ways", () => {
    const pinned = new Map([["src/a.ts", ["Simulation", "sim/loop"]]]);
    expect(compare(pinned, new Map([["src/a.ts", new Set(["Simulation"])], ["src/b.ts", new Set(["Simulation"])]]))).toEqual({ grown: ["src/a.ts: sim/loop"], stale: ["src/b.ts: Simulation"] });
  });
});
