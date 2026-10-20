import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DUAL_RUN } from "../build/engineBundle";
import { repoRel, repoRoot, sourceFiles } from "./guardFiles";
import { globRegex, isTestFile, resolveGlob, resolveRelative, scanRuntimeImports, type ImportKind, type RuntimeImport } from "./importScan";

/**
 * Where production code crosses into the TypeScript `Simulation`, held to a
 * ratchet.
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
 * runtime imports lead to `src/engine/Simulation.ts`, plus a dual-run file
 * whose imports lead there through engine modules. An edge into that set
 * from any other file outside `src/engine/` is a crossing, and the ratchet
 * names each crossing file with the modules it imports, and a reason.
 *
 * It pins crossings only. A file that reaches `Simulation` through another
 * non-engine file (one that imports `src/main.ts`, say) gets no line of its
 * own: its path in is that other file's line, which goes when the slice
 * that moves that file behind the port lands.
 *
 * A lazy crossing (`import()`, a worker or asset URL, a lazy glob) into the
 * reach set, or any crossing into an engine module that loads `Simulation`
 * lazily, fails outright: a lazy edge into `Simulation` is how the adapter
 * that hosts the fallback will load it, and that adapter is the one exception
 * a later slice adds. The dual run's files (`DUAL_RUN` in
 * `src/build/engineBundle.ts`, which a player build may not carry) may import
 * the set statically without a line, and nothing else is exempt. An import
 * the guard cannot read fails too, except the known count in each file that
 * loads the engine package's glue by URL ({@link PACKAGE_LOADERS}).
 *
 * The list only shrinks as slices 2 to 12 move consumers behind the port. A
 * new line needs a reason the PR states and a reviewer accepts.
 */
const here = dirname(fileURLToPath(import.meta.url));

const SIMULATION = "src/engine/Simulation.ts";
const ENGINE_DIR = "src/engine/";
const isEngine = (rel: string): boolean => rel.startsWith(ENGINE_DIR);

/** Files whose static imports of the reach set need no ratchet line. */
const EXEMPT: ReadonlySet<string> = new Set(DUAL_RUN);

/** Files whose `import()` loads the engine package's glue by URL, a file
 *  outside `src/` that no TypeScript source reaches through, with how many
 *  such imports each holds (the dual-run worker loads the shadow's). */
const PACKAGE_LOADERS: ReadonlyMap<string, number> = new Map([
  ["src/wasmhost/engineLoad.ts", 1],
  ["src/dualrun/worker.ts", 1],
]);

interface Edge {
  from: string;
  to: string;
  kind: ImportKind;
}

interface Graph {
  edges: Edge[];
  /** `file:line` of each import the scan cannot read. */
  unreadable: string[];
}

/** A ratchet name for a file: its path under `src/engine/` without the
 *  extension (`Simulation`, `sim/loop`; a directory's `index.ts` is the
 *  directory, the engine root's is `index`), or its repo path without the
 *  extension for a file outside the engine. */
function moduleName(rel: string): string {
  const path = rel.replace(/\.tsx?$/, "");
  if (!isEngine(rel)) return path;
  const inner = path.slice(ENGINE_DIR.length);
  return inner === "index" ? inner : inner.replace(/\/index$/, "");
}

/** The source files an import loads, among `files`: one file for an import
 *  or URL, every match less the call's `!` patterns for a glob, none for a
 *  package. Null for a glob pattern that is neither relative nor
 *  root-absolute, which the guard cannot place. */
function targets(files: ReadonlySet<string>, rel: string, imp: RuntimeImport): string[] | null {
  if (imp.glob) {
    const glob = resolveGlob(rel, imp.spec);
    if (glob === null) return null;
    const excluded = imp.glob.exclude.map((x) => resolveGlob(rel, x));
    if (excluded.includes(null)) return null;
    const pattern = globRegex(glob);
    const not = (excluded as string[]).map((x) => globRegex(x.slice(1)));
    return [...files].filter((f) => pattern.test(f) && !not.some((x) => x.test(f)));
  }
  const base = resolveRelative(rel, imp.spec);
  if (base === null) return [];
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
    for (const imp of scan.imports) {
      const found = targets(files, rel, imp);
      if (found === null) unreadable.push(`${rel}: ${imp.spec}`);
      else for (const to of found) edges.push({ from: rel, to, kind: imp.kind });
    }
  }
  return { edges, unreadable };
}

/** A file the reach set may hold: an engine module or a dual-run file. A
 *  chain through any other file counts at that file's own crossing. */
const inReachScope = (rel: string): boolean => isEngine(rel) || EXEMPT.has(rel);

/** Every engine module and dual-run file whose imports lead to
 *  `SIMULATION` through such files, following static edges only, or edges
 *  of every kind. */
function leadsToSimulation(graph: Graph, everyKind: boolean): Set<string> {
  const importers = new Map<string, string[]>();
  for (const { from, to, kind } of graph.edges) {
    if (!inReachScope(from) || (!everyKind && kind !== "static")) continue;
    const list = importers.get(to);
    if (list) list.push(from);
    else importers.set(to, [from]);
  }
  const reached = new Set([SIMULATION]);
  const queue = [SIMULATION];
  for (let i = 0; i < queue.length; i++) {
    for (const from of importers.get(queue[i]) ?? []) {
      if (reached.has(from)) continue;
      reached.add(from);
      queue.push(from);
    }
  }
  return reached;
}

interface Reach {
  /** Engine modules, and dual-run files, whose static imports lead to `Simulation`. */
  reach: Set<string>;
  /** Engine modules that lead to it only through a lazy edge. */
  lazyOnly: Set<string>;
}

function reachSets(graph: Graph): Reach {
  const reach = leadsToSimulation(graph, false);
  const lazyOnly = new Set([...leadsToSimulation(graph, true)].filter((f) => isEngine(f) && !reach.has(f)));
  return { reach, lazyOnly };
}

/** The crossings into the reach set: each non-engine file's static targets
 *  as ratchet names, sorted, and every lazy crossing as `from -> name (kind)`. */
function crossings(graph: Graph, { reach, lazyOnly }: Reach): { pinned: Map<string, string[]>; lazy: string[] } {
  const pinned = new Map<string, Set<string>>();
  const lazy: string[] = [];
  for (const { from, to, kind } of graph.edges) {
    if (isEngine(from) || from === to) continue;
    if (lazyOnly.has(to)) lazy.push(`${from} -> ${moduleName(to)} (${kind}, into a module that loads Simulation lazily)`);
    else if (!reach.has(to)) continue;
    else if (kind !== "static") lazy.push(`${from} -> ${moduleName(to)} (${kind})`);
    else if (!EXEMPT.has(from)) pinned.set(from, (pinned.get(from) ?? new Set()).add(moduleName(to)));
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

/** The imports the guard cannot read, less each package loader's known
 *  count; a loader whose count moved is reported. */
function unreadableImports(graph: Graph): string[] {
  const fileOf = (at: string): string => at.slice(0, at.indexOf(":"));
  const perLoader = new Map<string, number>();
  const out: string[] = [];
  for (const at of graph.unreadable) {
    const file = fileOf(at);
    if (PACKAGE_LOADERS.has(file)) perLoader.set(file, (perLoader.get(file) ?? 0) + 1);
    else out.push(at);
  }
  for (const [file, count] of PACKAGE_LOADERS) {
    const found = perLoader.get(file) ?? 0;
    if (found !== count) out.push(`${file}: ${found} unreadable imports where PACKAGE_LOADERS expects ${count}`);
  }
  return out;
}

/** Every non-test source file under `src/`, outside the test tree. */
function productionFiles(): string[] {
  return sourceFiles("src", [".ts", ".tsx"])
    .map(repoRel)
    .filter((rel) => !rel.endsWith(".d.ts") && !isTestFile(rel) && !rel.startsWith("src/tests/") && !rel.includes("/__mocks__/"))
    .sort();
}

describe("where production code crosses into the TypeScript Simulation", () => {
  const files = productionFiles();
  const graph = buildGraph(new Map(files.map((rel) => [rel, readFileSync(resolve(repoRoot, rel), "utf8")])));
  const sets = reachSets(graph);
  const { pinned, lazy } = crossings(graph, sets);
  const ratchet = parseRatchet(readFileSync(resolve(here, "simulationReach.ratchet.txt"), "utf8"));

  it("scans all of src/, the engine, host and save code included, and leaves out the tests", () => {
    // A scan that silently found nothing would pass forever.
    expect(files.length).toBeGreaterThan(300);
    for (const rel of [SIMULATION, "src/main.ts", "src/storage/SaveGame.ts", "src/wasmhost/wasmHost.ts", "src/dualrun/dualRun.ts", "src/simport/tsSim.ts"]) expect(files).toContain(rel);
    expect(files.some((rel) => rel.startsWith("src/tests/") || isTestFile(rel))).toBe(false);
    expect(graph.edges.length).toBeGreaterThan(1000);
  });

  it("finds the engine modules that lead to Simulation", () => {
    expect(sets.reach.has(SIMULATION)).toBe(true);
    expect([...sets.reach].every((f) => isEngine(f) || EXEMPT.has(f))).toBe(true);
    // The step loop imports it; if this fails the engine moved, and the
    // ratchet's lines may need their module names updated.
    expect(sets.reach.has("src/engine/sim/loop.ts"), [...sets.reach].sort().join("\n")).toBe(true);
  });

  it("exempts only the dual run, by the build guard's own list", () => {
    expect(DUAL_RUN.length).toBeGreaterThan(0);
    for (const rel of DUAL_RUN) expect(existsSync(resolve(repoRoot, rel)), rel).toBe(true);
  });

  it("can read every import under src/, except the engine package's loader", () => {
    const unread = unreadableImports(graph);
    expect(unread, "The guard cannot tell what these import; give import(), the URL or the glob a string literal, and start a glob pattern " +
        `(its \`!\` patterns too) with ./, ../ or /:\n${unread.join("\n")}`).toEqual([]);
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
  const BASE: Record<string, string> = {
    [SIMULATION]: 'import { tick } from "./sim/loop";\nexport class Simulation {}',
    "src/engine/sim/loop.ts": "export const tick = 1;",
    "src/engine/sim/save.ts": 'import { Simulation } from "../Simulation";\nexport const save = Simulation;',
    "src/engine/deep/a/b/save.ts": 'import { Simulation } from "../../../Simulation";\nexport const deep = Simulation;',
    "src/engine/types.ts": "export const KINDS = [];",
    "src/engine/index.ts": 'export * from "./types";',
    "src/game/helper.ts": 'import { Simulation } from "../engine/Simulation";\nexport const h = Simulation;',
    "src/ui/panel.ts": 'import { h } from "../game/helper";\nimport { KINDS } from "../engine";',
    "src/ui/typed.ts": 'import type { Simulation } from "../engine/Simulation";\nimport { type Simulation as S } from "../engine/Simulation.ts";',
  };
  const tree = (extra: Record<string, string> = {}) => {
    const graph = buildGraph(new Map(Object.entries({ ...BASE, ...extra })));
    const sets = reachSets(graph);
    return { graph, ...sets, ...crossings(graph, sets) };
  };

  it("counts a chain through a non-engine helper at its crossing edge only", () => {
    const { reach, pinned, lazy } = tree();
    expect([...reach].sort()).toEqual(["src/engine/Simulation.ts", "src/engine/deep/a/b/save.ts", "src/engine/sim/save.ts"]);
    expect(pinned).toEqual(new Map([["src/game/helper.ts", ["Simulation"]]]));
    expect(lazy).toEqual([]);
  });

  it("does not count a type-only import, or a file's text or address", () => {
    const { pinned } = tree({ "src/ui/text.ts": 'import raw from "../engine/Simulation.ts?raw";\nimport url from "../engine/Simulation.ts?url";' });
    expect(pinned.has("src/ui/typed.ts")).toBe(false);
    expect(pinned.has("src/ui/text.ts")).toBe(false);
  });

  it("reports a dynamic import, a worker or asset URL and a lazy glob into the set as lazy edges", () => {
    const { pinned, lazy } = tree({
      "src/ui/later.ts": 'export const load = () => import("/engine/Simulation.ts#x");',
      "src/ui/worker.ts": 'export const w = new URL("../engine/sim/save.ts?worker", import.meta.url);\nimport W from "../engine/sim/loop?worker";',
      "src/ui/bare.ts": 'export const u = new URL("save.ts", import.meta.url);',
      "src/engine/sim/bare.ts": "",
      "src/ui/all.ts": 'export const all = import.meta.glob(["../engine/**/*.{ts,tsx}", "!../engine/sim/**"]);',
    });
    expect(pinned.size).toBe(1);
    expect(lazy).toEqual([
      "src/ui/all.ts -> Simulation (glob)",
      "src/ui/all.ts -> deep/a/b/save (glob)",
      "src/ui/later.ts -> Simulation (dynamic)",
      "src/ui/worker.ts -> sim/save (url)",
    ]);
  });

  it("counts an eager glob as a static import", () => {
    const { pinned } = tree({ "src/ui/eager.ts": 'export const all = import.meta.glob("../engine/sim/s?ve.ts", { eager: true });' });
    expect(pinned.get("src/ui/eager.ts")).toEqual(["sim/save"]);
  });

  it("counts a worker URL or inline worker as a lazy edge, and reads a query on a plain import as a query", () => {
    const { pinned, lazy } = tree({
      "src/ui/workerUrl.ts": 'import u from "../engine/Simulation?worker&url";\nimport i from "../engine/sim/save.ts?inline&worker";',
      "src/ui/versioned.ts": 'import { Simulation } from "../engine/Simulation?v=1";',
    });
    expect(lazy).toEqual(["src/ui/workerUrl.ts -> Simulation (url)", "src/ui/workerUrl.ts -> sim/save (url)"]);
    expect(pinned.get("src/ui/versioned.ts")).toEqual(["Simulation"]);
  });

  it("applies a glob call's exclusions to that call only, and cannot place a pattern with no base", () => {
    const { lazy, graph } = tree({
      "src/ui/two.ts": 'export const a = import.meta.glob(["../engine/sim/*.ts", "!../engine/sim/save.ts"]);\nexport const b = import.meta.glob("../engine/sim/save.ts");',
      "src/ui/based.ts": 'export const c = import.meta.glob("**/Simulation.ts");',
    });
    expect(lazy).toEqual(["src/ui/two.ts -> sim/save (glob)"]);
    expect(unreadableImports(graph)).toContain("src/ui/based.ts: **/Simulation.ts");
  });

  it("fails a crossing into an engine module that loads Simulation lazily", () => {
    const { lazyOnly, lazy } = tree({
      "src/engine/fallbackLoader.ts": 'export const load = () => import("./Simulation");',
      "src/main.ts": 'import { load } from "./engine/fallbackLoader";',
    });
    expect([...lazyOnly]).toEqual(["src/engine/fallbackLoader.ts"]);
    expect(lazy).toEqual(["src/main.ts -> fallbackLoader (static, into a module that loads Simulation lazily)"]);
  });

  it("turns an engine module that starts importing Simulation into new lines for its importers", () => {
    const { reach, pinned } = tree({ "src/engine/types.ts": 'import "./sim/save";\nexport const KINDS = [];' });
    expect(reach.has("src/engine/index.ts")).toBe(true);
    expect(pinned.get("src/ui/panel.ts")).toEqual(["index"]);
  });

  it("lets the dual run import the set statically, but pins whoever imports a dual-run file that reaches it", () => {
    const [dual] = DUAL_RUN;
    const { pinned, lazy } = tree({
      [dual]: 'import { Simulation } from "../engine/Simulation";',
      "src/bootstrap.ts": 'import { start } from "./dualrun/dualRun";',
    });
    expect(pinned.has(dual)).toBe(false);
    expect(pinned.get("src/bootstrap.ts")).toEqual([dual.replace(/\.ts$/, "")]);
    expect(lazy).toEqual([]);
    expect(tree({ [dual]: 'const l = () => import("../engine/sim/save");' }).lazy).toEqual([`${dual} -> sim/save (dynamic)`]);
  });

  it("keeps a dual-run file that reaches Simulation only through a non-engine file out of the set", () => {
    const [dual] = DUAL_RUN;
    const { reach, pinned } = tree({
      [dual]: 'import { h } from "../game/helper";',
      "src/bootstrap.ts": 'import { start } from "./dualrun/dualRun";',
    });
    expect(reach.has(dual)).toBe(false);
    expect(pinned.has("src/bootstrap.ts")).toBe(false);
    expect(pinned.get("src/game/helper.ts")).toEqual(["Simulation"]);
  });

  it("names a directory's index module by its directory", () => {
    expect(moduleName("src/engine/index.ts")).toBe("index");
    expect(moduleName("src/engine/sim/index.ts")).toBe("sim");
    expect(moduleName("src/engine/Simulation.ts")).toBe("Simulation");
    expect(moduleName("src/dualrun/dualRun.ts")).toBe("src/dualrun/dualRun");
  });

  it("reports every import it cannot read, and holds each package loader to its count", () => {
    const { graph } = tree({
      "src/ui/computed.ts": "const n = 'x';\nimport(n);\nnew URL(n, import.meta.url);\nimport.meta.glob(n);",
      "src/wasmhost/engineLoad.ts": "const g = 'x';\nimport(g);\nimport(g);",
      "src/dualrun/worker.ts": "const g = 'x';\nimport(g);",
      "src/dualrun/dualRun.ts": "const g = 'x';\nimport(g);",
    });
    expect(unreadableImports(graph)).toEqual([
      "src/ui/computed.ts:2",
      "src/ui/computed.ts:3",
      "src/ui/computed.ts:4",
      "src/dualrun/dualRun.ts:2",
      "src/wasmhost/engineLoad.ts: 2 unreadable imports where PACKAGE_LOADERS expects 1",
    ]);
  });

  it("compares lines both ways", () => {
    const pinned = new Map([["src/a.ts", ["Simulation", "sim/loop"]]]);
    expect(compare(pinned, new Map([["src/a.ts", new Set(["Simulation"])], ["src/b.ts", new Set(["Simulation"])]]))).toEqual({ grown: ["src/a.ts: sim/loop"], stale: ["src/b.ts: Simulation"] });
  });
});
