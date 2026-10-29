/**
 * `npm run perf:load-memory`: the engine's WASM memory around a load (#1225,
 * slice 13 of the facade plan). For each perf scenario
 * (`src/tests/perfCompare/scenarios.ts`) each repetition runs four fresh Node
 * processes, since a WASM memory never shrinks. The first loads the save with
 * `Engine.fromSave` and records the linear memory before the load, after it,
 * after an hour of play (30 steps of two minutes) and after one `serialize`
 * (what an autosave and a restore point ask for). It times the load, that
 * `serialize` and a second one straight after it (which finds the memory the
 * first one grew). Then it frees the engine, loads a second one from the same
 * save in the same module (as an undo, a redo or a load does), timing that
 * load, plays it the same hour and times its first `serialize`, with the
 * memory after it; then it searches for a place a floor tile can go alone,
 * builds it on that engine and times the build and the `serialize` after it
 * (a build between two saves, as the undo capture before each edit places
 * it), with the memory after the search, the build and the save. A third
 * engine then repeats the second's load, hour, save, build and save, timing
 * its load, that build and the save after it, which shows whether their
 * costs come back on every later load. It also records what the first load
 * left on the JS heap once collected. The second process loads the save,
 * searches, builds the tile at once (the unit list leaves the load at its
 * exact size, so the first build may move it) and saves, recording the
 * memory after each step and the build's and the save's times, apart from
 * the hour and the other saves. Two more processes each play the hour and then
 * write one file, the `.vctower` (`exportVctower`) in the first and the `.TDT`
 * (`tdtExport`) in the second, recording the memory and the time of that
 * write, since each export has its own peak (#1338, #1431).
 *
 * It measures the Node package `npm run wasm:build` writes to `engine-rs/pkg/`
 * and names it by the source hash the same build stamps into the package's
 * `.wasm` (the `verticopolis.build` section, which `BUILD.json`'s `sources`
 * repeats); it stops when the `.wasm` carries no readable stamp.
 * `--engine <checkout>` measures another checkout's build instead (its own
 * `engine-rs/pkg/`) on this checkout's scenarios, which is how a before and
 * after pair is taken:
 *
 *   git worktree add --detach ../vc-before <base commit>
 *   (cd ../vc-before && npm ci && npm run wasm:build)
 *   npm run wasm:build
 *   npm run perf:load-memory -- --engine ../vc-before --json before.json
 *   npm run perf:load-memory -- --json after.json
 *
 *   npm run perf:load-memory -- --reps 10 --scenario large
 *
 * The child processes run under the same Node flags as this one (`tsx`'s
 * loader among them) plus `--expose-gc`, and print one JSON line each.
 * Numbers from a cloud machine are estimates. M6's figures come from the
 * owner's desktop under docs/performance/benchmark-protocol.md, in a browser.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_SECTION, customSectionsOf, parseBuildMetadata } from "../src/wasmhost/buildSection";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SCRIPT), "..");
const PKG = "engine-rs/pkg/verticopolis_engine.js";
const WASM = "engine-rs/pkg/verticopolis_engine_bg.wasm";
const MIB = 1024 * 1024;
/** The options, each followed by its value. */
const OPTIONS = ["--reps", "--scenario", "--json", "--engine"];
/** A child that runs longer than this has hung; on the large tower each child takes a few seconds. */
const CHILD_TIMEOUT_MS = 120_000;

interface Sample {
  before: number;
  afterLoad: number;
  /** In its own process, after the search for a lone floor tile. */
  afterSearch: number;
  /** After that floor tile is built. */
  afterBuild: number;
  /** That build's wall time. */
  buildMs: number;
  /** The `serialize` straight after that build. */
  buildSaveMs: number;
  /** After that `serialize`. */
  afterBuildThenSave: number;
  /** Where the floor tile went, as "floor, x". */
  built: string;
  afterPlay: number;
  afterSerialize: number;
  loadMs: number;
  /** The first `serialize` after the load and the hour. */
  serializeMs: number;
  /** The `serialize` straight after that one. */
  secondSerializeMs: number;
  /** A second engine's load from the same save, in the same module. */
  reloadMs: number;
  /** A second engine's first `serialize`, in the same module. */
  reloadSerializeMs: number;
  /** After that second engine's load, hour and `serialize`. */
  afterReload: number;
  /** After the search for a lone floor tile on the second engine. */
  afterReloadSearch: number;
  /** A lone floor tile built on the second engine, after its save. */
  laterBuildMs: number;
  /** After that build. */
  afterLaterBuild: number;
  /** The `serialize` after that build. */
  saveAfterBuildMs: number;
  /** After that build and `serialize`. */
  afterBuildSave: number;
  /** A third engine's load, in the same module. */
  thirdLoadMs: number;
  /** A third engine's build, after its load, hour and save, in the same module. */
  thirdBuildMs: number;
  /** The `serialize` after that build. */
  thirdSaveAfterBuildMs: number;
  /** After the third engine's build and `serialize`. */
  afterThird: number;
  heapDelta: number;
  /** In its own process, after the hour and a `.vctower` export, and that export's wall time. */
  afterVctower: number;
  vctowerMs: number;
  /** In its own process, after the hour and a `.TDT` export, that export's wall time and status. */
  afterTdt: number;
  tdtMs: number;
  tdtStatus: number;
}

interface Engine {
  build(kind: string, floor: number, x: number): string;
  canBuild(kind: string, floor: number, x: number): string;
  money(): number;
  tick(dtMinutes: number): void;
  serialize(): string;
  /** The port's file members, which a build from before #1390 lacks. */
  exportVctower?(appVersion: string, savedAtMs: number): string | undefined;
  tdtExport?(): number[];
  free(): void;
}

/** The floors and tiles the search covers: every floor above the lobby, every tile of the lot. */
const TOP_FLOOR = 120;
const LOT_WIDTH = 375;

/**
 * Where one floor tile can go alone: the first place from the bottom left,
 * above the lobby, whose price is a single tile's (so no bridge or lobby is
 * laid with it), and that price. Every price `canBuild` gives for a floor
 * tile is at least a single tile's (a refusal carries the base price or the
 * full one, and a full price adds the bridged tiles), so the lowest one seen
 * is that price.
 */
function loneTile(engine: Engine): { floor: number; x: number; cost: number } {
  type Check = { ok: boolean; cost: number };
  const checks: (Check & { floor: number; x: number })[] = [];
  for (let floor = 2; floor <= TOP_FLOOR; floor++) {
    for (let x = 0; x < LOT_WIDTH; x++) checks.push({ floor, x, ...(JSON.parse(engine.canBuild("floor", floor, x)) as Check) });
  }
  const single = checks.reduce((low, c) => (c.cost > 0 && c.cost < low ? c.cost : low), Infinity);
  const spot = checks.find((c) => c.ok && c.cost === single);
  if (!spot) throw new Error(`no floor tile could be built alone at ${single}`);
  return { floor: spot.floor, x: spot.x, cost: single };
}

/**
 * Builds the floor tile `loneTile` found, returning the build's wall time. It
 * throws unless the build took exactly that tile's price, so a build that
 * laid more than one tile is never measured as one.
 */
function buildAt(engine: Engine, { floor, x, cost }: ReturnType<typeof loneTile>): number {
  const money = engine.money();
  const start = performance.now();
  const built = JSON.parse(engine.build("floor", floor, x)) as { ok: boolean };
  const ms = performance.now() - start;
  if (!built.ok) throw new Error(`floor ${floor}, x ${x} passed canBuild but did not build`);
  const spent = money - engine.money();
  if (spent !== cost) throw new Error(`floor ${floor}, x ${x} cost ${spent}, where one tile costs ${cost}`);
  return ms;
}

/** What one child measures: the play and save steps, one build, or one export. */
type Step = "play" | "build" | "vctower" | "tdt";
const STEPS: readonly string[] = ["play", "build", "vctower", "tdt"];

/** One load in this process, then `step`: the child half of the script. */
function child(pkgPath: string, savePath: string, step: Step): void {
  // The Node glue keeps its instance to itself; catch it as it is built.
  let instance: WebAssembly.Instance | undefined;
  const Original = WebAssembly.Instance;
  WebAssembly.Instance = new Proxy(Original, {
    construct(target, args: [WebAssembly.Module, WebAssembly.Imports?]) {
      instance = new target(...args);
      return instance;
    },
  });
  let mod: { Engine: { fromSave(text: string): Engine } };
  try {
    mod = createRequire(SCRIPT)(pkgPath) as typeof mod;
  } finally {
    WebAssembly.Instance = Original;
  }
  const memory = instance?.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error(`${pkgPath} did not build a WASM memory`);
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error("run the child with --expose-gc");
  const text = readFileSync(savePath, "utf8");
  gc();
  const heap = process.memoryUsage().heapUsed;
  const before = memory.buffer.byteLength;
  const start = performance.now();
  let engine = mod.Engine.fromSave(text);
  const loadMs = performance.now() - start;
  const afterLoad = memory.buffer.byteLength;
  gc();
  const heapDelta = process.memoryUsage().heapUsed - heap;
  let sample: Partial<Sample>;
  if (step === "build") {
    const tile = loneTile(engine);
    const afterSearch = memory.buffer.byteLength;
    const buildMs = buildAt(engine, tile);
    const afterBuild = memory.buffer.byteLength;
    const saveStart = performance.now();
    engine.serialize();
    const buildSaveMs = performance.now() - saveStart;
    sample = { afterLoad, afterSearch, afterBuild, buildMs, buildSaveMs, afterBuildThenSave: memory.buffer.byteLength, built: `${tile.floor}, ${tile.x}` };
  } else if (step === "vctower" || step === "tdt") {
    for (let i = 0; i < 30; i++) engine.tick(2);
    const afterPlay = memory.buffer.byteLength;
    const exportStart = performance.now();
    if (step === "vctower") {
      if (!engine.exportVctower) throw new Error(`${pkgPath} has no exportVctower`);
      const file = engine.exportVctower("3.0.0", 1.7e12);
      if (!file?.startsWith("VCTOWER1")) throw new Error("the .vctower export wrote no file");
      sample = { afterLoad, afterPlay, afterVctower: memory.buffer.byteLength, vctowerMs: performance.now() - exportStart };
    } else {
      if (!engine.tdtExport) throw new Error(`${pkgPath} has no tdtExport`);
      const record = engine.tdtExport();
      sample = { afterLoad, afterPlay, afterTdt: memory.buffer.byteLength, tdtMs: performance.now() - exportStart, tdtStatus: record[0] };
    }
  } else {
    for (let i = 0; i < 30; i++) engine.tick(2);
    const afterPlay = memory.buffer.byteLength;
    const saveStart = performance.now();
    engine.serialize();
    const serializeMs = performance.now() - saveStart;
    const afterSerialize = memory.buffer.byteLength;
    const secondStart = performance.now();
    engine.serialize();
    const secondSerializeMs = performance.now() - secondStart;
    engine.free();
    const reloadLoadStart = performance.now();
    engine = mod.Engine.fromSave(text);
    const reloadMs = performance.now() - reloadLoadStart;
    for (let i = 0; i < 30; i++) engine.tick(2);
    const reloadStart = performance.now();
    engine.serialize();
    const reloadSerializeMs = performance.now() - reloadStart;
    const afterReload = memory.buffer.byteLength;
    // A build between two saves, as the undo capture before each edit places it.
    const tile = loneTile(engine);
    const afterReloadSearch = memory.buffer.byteLength;
    const laterBuildMs = buildAt(engine, tile);
    const afterLaterBuild = memory.buffer.byteLength;
    const lastStart = performance.now();
    engine.serialize();
    const saveAfterBuildMs = performance.now() - lastStart;
    const afterBuildSave = memory.buffer.byteLength;
    // The same again on a third engine: a cost that comes back on every load shows here.
    engine.free();
    const thirdLoadStart = performance.now();
    engine = mod.Engine.fromSave(text);
    const thirdLoadMs = performance.now() - thirdLoadStart;
    for (let i = 0; i < 30; i++) engine.tick(2);
    engine.serialize();
    const thirdBuildMs = buildAt(engine, loneTile(engine));
    const thirdStart = performance.now();
    engine.serialize();
    const thirdSaveAfterBuildMs = performance.now() - thirdStart;
    const afterThird = memory.buffer.byteLength;
    sample = { before, afterLoad, afterPlay, afterSerialize, loadMs, serializeMs, secondSerializeMs, reloadMs, reloadSerializeMs, afterReload, afterReloadSearch, laterBuildMs, afterLaterBuild, saveAfterBuildMs, afterBuildSave, thirdLoadMs, thirdBuildMs, thirdSaveAfterBuildMs, afterThird, heapDelta };
  }
  process.stdout.write(`${JSON.stringify(sample)}\n`);
  engine.free();
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  if (args.lastIndexOf(name) !== at) throw new Error(`${name} is given twice`);
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mib = (bytes: number): string => (bytes / MIB).toFixed(2);

/** A time's median, with its range over the repetitions. */
const spread = (ms: number[]): string => `${median(ms).toFixed(1)} (${Math.min(...ms).toFixed(1)} to ${Math.max(...ms).toFixed(1)})`;

/** The same figure from every repetition, or each one when they differ. */
function steady(xs: number[]): string {
  return xs.every((x) => x === xs[0]) ? mib(xs[0]) : xs.map(mib).join(" / ");
}

/** One child's run on the save at `path`: the last line it printed. */
function runChild(name: string, pkgPath: string, path: string, step: Step): Partial<Sample> {
  const run = spawnSync(process.execPath, [...process.execArgv, "--expose-gc", SCRIPT, "--child", pkgPath, path, step], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  if (run.error) throw new Error(`${name}: the child did not finish: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${name}: the child failed (${run.status}): ${run.stderr}`);
  const line = run.stdout.trim().split("\n").pop();
  if (!line) throw new Error(`${name} (${step}): the child printed nothing`);
  try {
    return JSON.parse(line) as Partial<Sample>;
  } catch {
    throw new Error(`${name} (${step}): the child printed ${line.slice(0, 120)}`);
  }
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "--child") {
    if (!STEPS.includes(args[3])) throw new Error(`unknown child step ${args[3]}`);
    return child(args[1], args[2], args[3] as Step);
  }
  for (let i = 0; i < args.length; i += 2) {
    if (!OPTIONS.includes(args[i])) throw new Error(`unknown option ${args[i]}; the options are ${OPTIONS.join(", ")}`);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${args[i]} needs a value`);
  }
  const reps = Number(option(args, "--reps") ?? 5);
  if (!Number.isInteger(reps) || reps < 1) throw new Error("--reps must be a positive whole number");
  const only = option(args, "--scenario");
  const jsonOut = option(args, "--json");
  const engineRoot = resolve(option(args, "--engine") ?? REPO);
  const pkgPath = resolve(engineRoot, PKG);
  const wasmPath = resolve(engineRoot, WASM);
  const stamp = parseBuildMetadata(customSectionsOf(readFileSync(wasmPath), BUILD_SECTION));
  if (stamp.state !== "ok") throw new Error(`${wasmPath} carries no readable ${BUILD_SECTION} stamp (${stamp.state === "malformed" ? stamp.why : "missing"}); run npm run wasm:build there`);
  const sources = stamp.sourceHash;
  const { buildScenarios, unknownScenarios } = await import("../src/tests/perfCompare/scenarios");
  if (only && unknownScenarios([only]).length > 0) throw new Error(`no scenario named ${only}`);
  const scenarios = buildScenarios(only ? [only] : undefined);
  const dir = mkdtempSync(join(tmpdir(), "vc-load-memory-"));
  const results: Record<string, { sha256: string; units: number; saveBytes: number; samples: Sample[] }> = {};
  try {
    for (const s of scenarios) {
      const path = join(dir, `${s.name}.json`);
      writeFileSync(path, s.save);
      const samples: Sample[] = [];
      for (let r = 0; r < reps; r++) {
        const played = runChild(s.name, pkgPath, path, "play");
        const built = runChild(s.name, pkgPath, path, "build");
        const vctower = runChild(s.name, pkgPath, path, "vctower");
        const tdt = runChild(s.name, pkgPath, path, "tdt");
        // The two processes load the same build and save, so they must agree.
        for (const other of [built, vctower, tdt]) {
          if (other.afterLoad !== played.afterLoad) throw new Error(`${s.name}: the two loads left ${played.afterLoad} and ${other.afterLoad} bytes`);
        }
        samples.push({
          ...played,
          afterSearch: built.afterSearch,
          afterBuild: built.afterBuild,
          buildMs: built.buildMs,
          buildSaveMs: built.buildSaveMs,
          afterBuildThenSave: built.afterBuildThenSave,
          built: built.built,
          afterVctower: vctower.afterVctower,
          vctowerMs: vctower.vctowerMs,
          afterTdt: tdt.afterTdt,
          tdtMs: tdt.tdtMs,
          tdtStatus: tdt.tdtStatus,
        } as Sample);
      }
      results[s.name] = { sha256: s.sha256, units: s.units, saveBytes: Buffer.byteLength(s.save), samples };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const lines = [
    `Engine sources ${sources.slice(0, 16)} (${engineRoot}), Node ${process.version}, ${reps} repetitions per scenario, each in two fresh processes. WASM memory in MiB.`,
    "",
    "The load, the hour, the saves, a second engine and a build on it, then a third engine, in one process (WASM memory, MiB):",
    "",
    "| Scenario | Units | Save MiB | Before load | After load | After an hour | After serialize | After a second engine's load, hour and save | After a search on it | After a build | After a save | After a third engine's load, hour, save, build and save | JS heap after load, MiB |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const each = (r: (typeof results)[string], key: keyof Sample) => r.samples.map((x) => x[key] as number);
  for (const [name, r] of Object.entries(results)) {
    const memory = (["before", "afterLoad", "afterPlay", "afterSerialize", "afterReload", "afterReloadSearch", "afterLaterBuild", "afterBuildSave", "afterThird"] as const).map((k) => steady(each(r, k)));
    lines.push(`| ${name} | ${r.units} | ${mib(r.saveBytes)} | ${memory.join(" | ")} | ${mib(median(each(r, "heapDelta")))} |`);
  }
  lines.push(
    "",
    "Wall times in that process, ms, median (min to max):",
    "",
    "| Scenario | Load | First serialize | Second serialize | Second engine's load | Its first serialize | A build on it | The serialize after that build | Third engine's load | A build on it | The serialize after that build |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [name, r] of Object.entries(results)) {
    const times = (["loadMs", "serializeMs", "secondSerializeMs", "reloadMs", "reloadSerializeMs", "laterBuildMs", "saveAfterBuildMs", "thirdLoadMs", "thirdBuildMs", "thirdSaveAfterBuildMs"] as const).map((k) => spread(each(r, k)));
    lines.push(`| ${name} | ${times.join(" | ")} |`);
  }
  lines.push(
    "",
    "One floor tile built straight after the load, then a save, in its own process (WASM memory in MiB; times in ms, median (min to max)):",
    "",
    "| Scenario | After load | After the search | After one build | After a save | Build ms | Save ms | Placed at (floor, x) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [name, r] of Object.entries(results)) {
    const memory = (["afterLoad", "afterSearch", "afterBuild", "afterBuildThenSave"] as const).map((k) => steady(each(r, k)));
    lines.push(`| ${name} | ${memory.join(" | ")} | ${spread(each(r, "buildMs"))} | ${spread(each(r, "buildSaveMs"))} | ${[...new Set(r.samples.map((x) => x.built))].join("; ")} |`);
  }
  lines.push(
    "",
    "A file written after the load and the hour, each in its own process (WASM memory in MiB; times in ms, median (min to max); a `.TDT` status of 0 is a refused tower, which writes nothing):",
    "",
    "| Scenario | After load | After an hour | After a `.vctower` | The `.vctower` ms | After a `.TDT` | The `.TDT` ms | `.TDT` status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [name, r] of Object.entries(results)) {
    const memory = (["afterLoad", "afterPlay", "afterVctower"] as const).map((k) => steady(each(r, k)));
    lines.push(`| ${name} | ${memory.join(" | ")} | ${spread(each(r, "vctowerMs"))} | ${steady(each(r, "afterTdt"))} | ${spread(each(r, "tdtMs"))} | ${[...new Set(each(r, "tdtStatus"))].join("; ")} |`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  if (jsonOut) {
    const record = { engineSources: sources, engineRoot, node: process.version, reps, results };
    writeFileSync(jsonOut, `${JSON.stringify(record, null, 2)}\n`);
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  process.stderr.write(`perf:load-memory: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(2);
});
