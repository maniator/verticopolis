import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { rentOf } from "../../engine/econConfig";
import { REPO_ROOT, type EngineStart, type Outcome, type ScenarioEngine } from "./scenario";
import { checkBinding, type WasmEngine, type WasmModule } from "../../dualrun/binding";

/**
 * The Rust engine behind the scenario surface, through its WASM binding
 * (`engine-rs/src/wasm.rs`, built by `npm run wasm:build` into
 * `engine-rs/pkg/`). Structured values cross the binding as JSON text; this
 * adapter parses them and nothing more, so a scenario drives the port exactly
 * as it drives the TypeScript engine.
 */

export const WASM_PKG = resolve(REPO_ROOT, "engine-rs/pkg/verticopolis_engine.js");
const WASM_BYTES = resolve(REPO_ROOT, "engine-rs/pkg/verticopolis_engine_bg.wasm");
const WASM_MARKER = resolve(REPO_ROOT, "engine-rs/pkg/package.json");

/** True once the binding has been built by the script (the glue, the module
 *  and the CommonJS marker it writes, without which the glue loads as ESM). The
 *  suite skips itself otherwise, except under `VC_REQUIRE_WASM=1`, which CI
 *  sets so a missing package fails the run instead of passing it. */
export const hasWasmPackage = (): boolean => [WASM_PKG, WASM_BYTES, WASM_MARKER].every((f) => existsSync(f));

/** CI's switch: the binding must be present, a skip is a failure. */
export const wasmRequired = (): boolean => process.env.VC_REQUIRE_WASM === "1";

let loaded: WasmModule | undefined;

/** Load the package once per process. It is CommonJS (wasm-bindgen's `nodejs`
 *  target) inside an ESM repository, so it comes in through `require`. One
 *  module instance serves every scenario; a Rust panic would leave it in an
 *  undefined state, so the binding returns errors rather than panicking. */
export function wasm(): WasmModule {
  if (loaded) return loaded;
  loaded = checkBinding(createRequire(import.meta.url)(WASM_PKG));
  return loaded;
}

const outcome = (json: string): Outcome => JSON.parse(json) as Outcome;

/** Integers cross the binding as 32-bit values and the glue wraps silently,
 *  so a tile, id or count outside that range is refused here rather than
 *  handed to the engine as a different number. */
function i32(v: number, what: string): number {
  if (!Number.isInteger(v) || v > 0x7fffffff || v < -0x80000000) throw new Error(`${what} ${v} is outside the binding's 32-bit range`);
  return v;
}
function u32(v: number, what: string): number {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`${what} ${v} is outside the binding's unsigned 32-bit range`);
  return v;
}

interface SavedUnit { id: number; kind: string; rent?: number; noRate?: boolean }
interface SavedTransport { id: number; kind: string; cars: number }

/** Wrap one binding instance. `free` releases it; the runner calls it on
 *  the engine it ends with, and `reload` frees the one it replaces. A call
 *  after that is an error here rather than a null pointer in the engine. */
export function wasmEngine(handle: WasmEngine): ScenarioEngine {
  let freed = false;
  const live = (): WasmEngine => {
    if (freed) throw new Error("this engine was freed");
    return handle;
  };
  return {
    free: () => {
      if (freed) return;
      freed = true;
      handle.free();
    },
    mode: () => live().mode(),
    money: () => live().money(),
    setMoney: (amount) => live().setMoney(amount),
    build: (kind, floor, x) => outcome(live().build(kind, i32(floor, "floor"), i32(x, "x"))),
    buildTransport: (kind, x, bottom, top) => outcome(live().buildTransport(kind, i32(x, "x"), i32(bottom, "bottom"), i32(top, "top"))),
    sellAt: (floor, x) => live().sellAt(i32(floor, "floor"), i32(x, "x")),
    unitAt: (floor, x) => {
      const text = live().unitAt(i32(floor, "floor"), i32(x, "x"));
      if (text === undefined) return null;
      const u = JSON.parse(text) as SavedUnit;
      return { id: u.id, kind: u.kind, rent: rentOf(u) };
    },
    transportAt: (floor, x) => {
      const text = live().transportAt(i32(floor, "floor"), i32(x, "x"));
      if (text === undefined) return null;
      const t = JSON.parse(text) as SavedTransport;
      return { id: t.id, kind: t.kind, cars: t.cars };
    },
    adjustRent: (id, dir) => live().adjustRent(i32(id, "id"), dir) ?? null,
    setNoRate: (id) => live().setNoRate(i32(id, "id")),
    setCars: (id, cars) => live().setCars(i32(id, "id"), i32(cars, "cars")),
    setSchedule: (id, schedule) => live().setSchedule(i32(id, "id"), JSON.stringify(schedule)),
    startFire: () => live().startFire(),
    fires: () => live().fires(),
    bombThreat: () => live().bombThreat(),
    evaluateStar: () => live().evaluateStar(),
    callExterminator: () => outcome(live().callExterminator()),
    autoBridge: () => live().autoBridge(),
    toggleAutoBridge: () => live().toggleAutoBridge(),
    resizeTransport: (id, bottom, top) => outcome(live().resizeTransport(i32(id, "id"), i32(bottom, "bottom"), i32(top, "top"))),
    clearStops: (id) => live().clearStops(i32(id, "id")),
    setStop: (id, floor, stop) => live().setStop(i32(id, "id"), i32(floor, "floor"), stop),
    priceUnit: (id, target) => live().priceUnit(i32(id, "id"), target) ?? null,
    setFilmPolicy: (id, policy) => live().setFilmPolicy(i32(id, "id"), policy) ?? null,
    rerollSubtype: (id) => live().rerollSubtype(i32(id, "id")) ?? null,
    applyRentBatch: (kind, target, onlyDefaultPriced) => {
      const text = live().applyRentBatch(kind, JSON.stringify(target), onlyDefaultPriced);
      return text === undefined ? null : (JSON.parse(text) as { matched: number }).matched;
    },
    pendingChoice: () => {
      const text = live().pendingChoice();
      return text === undefined ? null : (JSON.parse(text) as { kind: string; cost: number });
    },
    resolveChoice: (accept) => live().resolveChoice(accept),
    tick: (dt) => live().tick(dt),
    reload: () => {
      // The old instance is done once its save is taken; free it rather than
      // wait for the finalizer, since linear memory never shrinks.
      const loaded = wasm().Engine.fromSave(live().serialize());
      freed = true;
      handle.free();
      return wasmEngine(loaded);
    },
    stateDigest: () => live().stateDigest(),
    crowdDigest: () => live().crowdDigest(),
    drainEvents: () => JSON.parse(live().drainGameplayEvents()) as unknown[],
    eventsDropped: () => live().gameplayEventsDropped(),
  };
}

/** Start the Rust engine from a scenario's `start`, the way `startTsEngine`
 *  starts the TypeScript one: a new game by seed and mode, or a `.vctower`
 *  fixture through the import path with the mode overridden when given. */
export const startWasmEngine: EngineStart = (start) => {
  const { Engine } = wasm();
  // A start whose mode check fails frees the instance it refuses.
  const checked = (w: WasmEngine, mode: string | undefined, what: string): ScenarioEngine => {
    if (mode && w.mode() !== mode) {
      const found = w.mode();
      w.free();
      throw new Error(`${what} as ${found}, not ${mode}`);
    }
    return wasmEngine(w);
  };
  if ("newGame" in start) {
    return checked(Engine.newGame(u32(start.newGame.seed, "seed"), start.newGame.mode), start.newGame.mode, "new game founded");
  }
  return checked(Engine.fromVctower(readFileSync(resolve(REPO_ROOT, start.fixture), "utf8"), start.mode ?? null), start.mode, `${start.fixture} loaded`);
};
