/**
 * The loader fixes for #856 and #858 through the Rust engine's WASM binding,
 * against the TypeScript engine on the same save text.
 *
 * - A save taken at random state 0 (#856) loads at state 0 in both engines,
 *   main stream and event stream, and the two run on identically from there.
 *   Before the fix both engines loaded it at state 1, so this half compares
 *   each engine with the saved state as well as with each other.
 * - A null save is refused by both engines, and every other top-level value
 *   loads alike. The loader cases #856 and #858 added run through WASM with
 *   the rest of the table in `conformanceWasmSaves.integration.test.ts`, and
 *   natively in `load/loader_cases.rs`.
 * - EX-3 (proposed): a number literal past the double range, which
 *   `JSON.parse` reads as Infinity, is refused by the engine's JSON parser
 *   and loads in TypeScript. Both sides are pinned, so a change in either
 *   flips the test and the register entry has to be rewritten.
 *
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */
import { describe, expect, it } from "vitest";
import type { Engine } from "../../dualrun/engine";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/types";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type RustEngine = { Engine: typeof Engine };
const rust = (): RustEngine => wasm() as unknown as RustEngine;

/** A seed one draw before state 0: Mulberry32 adds 0x6d2b79f5 per draw. */
const ONE_BEFORE_ZERO = (2 ** 32 - 0x6d2b79f5) >>> 0;

/** A small Modern tower with some traffic, at 2 stars so the daily rolls draw
 *  from both streams (the emergency roll from the main stream, the thief's
 *  from the event stream). */
function tower(): Simulation {
  const sim = Simulation.newGame(7, "modern");
  sim.money = 1e8;
  for (let x = 170; x < 192; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (let fl = 2; fl <= 3; fl++) for (let x = 171; x < 191; x++) expect(sim.build("floor", fl, x).ok).toBe(true);
  expect(sim.build("office", 2, 172).ok).toBe(true);
  expect(sim.build("condo", 3, 172).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 171, 1, 3).ok).toBe(true);
  for (let i = 0; i < 72; i++) sim.tick(20);
  sim.star = 2;
  return sim;
}

const canonical = (text: string): string => canonicalJson(JSON.parse(text));

/** Both engines loaded from the same text, each serialized after `ticks` steps of 20 minutes. */
function both(text: string, ticks = 0): { ts: string; rust: string } {
  const sim = Simulation.deserialize(JSON.parse(text) as SerializedGame);
  const engine = rust().Engine.fromSave(text);
  try {
    for (let i = 0; i < ticks; i++) {
      sim.tick(20);
      engine.tick(20);
    }
    return { ts: JSON.stringify(sim.serialize()), rust: engine.serialize() };
  } finally {
    engine.free();
  }
}

const run = hasWasmPackage() || wasmRequired();

describe.runIf(run)("a save at random state 0 reloads at state 0 in both engines (#856)", () => {
  it("the main stream", () => {
    const sim = tower();
    sim.rng.restore(ONE_BEFORE_ZERO);
    sim.rng.next();
    const text = JSON.stringify(sim.serialize());
    const loaded = both(text);
    expect(JSON.parse(loaded.rust).seed).toBe(0);
    expect(JSON.parse(loaded.ts).seed).toBe(0);
    const ran = both(text, 144);
    expect(canonical(ran.rust)).toBe(canonical(ran.ts));
    expect(JSON.parse(ran.rust).seed, "the run draws from the main stream").not.toBe(0);
  });

  it("a new game seeded 0 still starts at state 1", () => {
    const engine = rust().Engine.newGame(0, "modern");
    try {
      expect(JSON.parse(engine.serialize()).seed).toBe(1);
    } finally {
      engine.free();
    }
    expect(Simulation.newGame(0, "modern").serialize().seed).toBe(1);
  });

  it("the event stream", () => {
    const sim = tower();
    const extra = (sim.events as unknown as { extra: { restore(s: number): void; next(): number } }).extra;
    extra.restore(ONE_BEFORE_ZERO);
    extra.next();
    const text = JSON.stringify(sim.serialize());
    expect(JSON.parse(text).events.rngState).toBe(0);
    const loaded = both(text);
    expect(JSON.parse(loaded.rust).events.rngState).toBe(0);
    expect(JSON.parse(loaded.ts).events.rngState).toBe(0);
    const ran = both(text, 144);
    expect(canonical(ran.rust)).toBe(canonical(ran.ts));
    expect(JSON.parse(ran.rust).events.rngState, "the run draws from the event stream").not.toBe(0);
  });
});

describe.runIf(run)("top-level values load alike in both engines (#858)", () => {
  it("refuses a null save in both engines, and loads any other top-level value alike", () => {
    expect(() => Simulation.deserialize(JSON.parse("null") as SerializedGame)).toThrow();
    expect(() => rust().Engine.fromSave("null")).toThrow(/null/);
    for (const text of ["5", "[]", '"abc"', '""', "true", "{}"]) {
      const { ts, rust: fromRust } = both(text);
      expect(canonical(fromRust), text).toBe(canonical(ts));
    }
  });
});

describe.runIf(run)("EX-3 (proposed): a number past the double range", () => {
  it("loads in TypeScript and is refused by the engine", () => {
    const save = JSON.stringify(tower().serialize());
    const withMoney = (literal: string): string => save.replace(/"money":[^,]+,/, `"money":${literal},`);
    const text = withMoney("1e400");
    expect(text).toContain('"money":1e400,');
    expect(() => Simulation.deserialize(JSON.parse(text) as SerializedGame)).not.toThrow();
    expect(() => rust().Engine.fromSave(text)).toThrow(/number out of range/);
    // The largest doubles still load in both.
    const { ts, rust: fromRust } = both(withMoney("1e308"));
    expect(canonical(fromRust)).toBe(canonical(ts));
  });
});
