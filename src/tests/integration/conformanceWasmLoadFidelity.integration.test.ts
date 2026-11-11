/**
 * The loader fixes for #856 and #858 through the Rust engine's WASM binding.
 *
 * - A save taken at random state 0 (#856) loads at state 0, main stream and
 *   event stream, and runs on from there. Before the fix the loader read state
 *   0 as "unset" and started at state 1.
 * - A null save is refused, and every other top-level value loads as the empty
 *   save does. The loader cases #856 and #858 added run through WASM with the
 *   rest of the table in `conformanceWasmSaves.integration.test.ts`, and
 *   natively in `load/loader_cases.rs`.
 * - EX-3: a number literal past the double range, which `JSON.parse` reads as
 *   Infinity, is refused by the engine's JSON parser, and the largest doubles
 *   still load.
 *
 * Until #1875 each half also compared the TypeScript engine on the same text.
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */
import { describe, expect, it } from "vitest";
import type { Engine } from "../../dualrun/engine";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

type RustEngine = { Engine: typeof Engine };
const rust = (): RustEngine => wasm() as unknown as RustEngine;

const ok = (answer: string): void => expect((JSON.parse(answer) as { ok: boolean }).ok).toBe(true);

/** A small Modern tower with some traffic, at 2 stars so the daily rolls draw
 *  from both streams (the emergency roll from the main stream, the thief's
 *  from the event stream), as save text. */
function tower(): string {
  const engine = rust().Engine.newGame(7, "modern");
  try {
    engine.setMoney(1e8);
    for (let x = 170; x < 192; x++) ok(engine.build("lobby", 1, x));
    for (let fl = 2; fl <= 3; fl++) for (let x = 171; x < 191; x++) ok(engine.build("floor", fl, x));
    ok(engine.build("office", 2, 172));
    ok(engine.build("condo", 3, 172));
    ok(engine.buildTransport("elevatorStandard", 171, 1, 3));
    for (let i = 0; i < 72; i++) engine.tick(20);
    const save = JSON.parse(engine.serialize()) as { star: number };
    save.star = 2;
    return JSON.stringify(save);
  } finally {
    engine.free();
  }
}

type Saved = { seed: number; events: { rngState: number } };
/** The text loaded, run `ticks` steps of 20 minutes, and saved again. */
function after(text: string, ticks = 0): Saved {
  const engine = rust().Engine.fromSave(text);
  try {
    for (let i = 0; i < ticks; i++) engine.tick(20);
    return JSON.parse(engine.serialize()) as Saved;
  } finally {
    engine.free();
  }
}
const canonical = (text: string): string => canonicalJson(JSON.parse(text));
const loaded = (text: string): string => {
  const engine = rust().Engine.fromSave(text);
  try {
    return canonical(engine.serialize());
  } finally {
    engine.free();
  }
};

const run = hasWasmPackage();

describe.runIf(run)("a save at random state 0 reloads at state 0 (#856)", () => {
  it("the main stream", () => {
    const save = JSON.parse(tower()) as Saved;
    save.seed = 0;
    const text = JSON.stringify(save);
    expect(after(text).seed).toBe(0);
    const ran = after(text, 144);
    expect(ran.seed, "the run draws from the main stream").not.toBe(0);
    // State 0 is a real state: the run differs from one loaded at state 1.
    save.seed = 1;
    expect(after(JSON.stringify(save), 144).seed).not.toBe(ran.seed);
  });

  it("a new game seeded 0 still starts at state 1", () => {
    const engine = rust().Engine.newGame(0, "modern");
    try {
      expect(JSON.parse(engine.serialize()).seed).toBe(1);
    } finally {
      engine.free();
    }
  });

  it("the event stream", () => {
    const save = JSON.parse(tower()) as Saved;
    save.events.rngState = 0;
    const text = JSON.stringify(save);
    expect(after(text).events.rngState).toBe(0);
    const ran = after(text, 144);
    expect(ran.events.rngState, "the run draws from the event stream").not.toBe(0);
    save.events.rngState = 1;
    expect(after(JSON.stringify(save), 144).events.rngState).not.toBe(ran.events.rngState);
  });
});

describe.runIf(run)("top-level values load alike (#858)", () => {
  it("refuses a null save, and loads any other top-level value as the empty save", () => {
    expect(() => rust().Engine.fromSave("null")).toThrow(/null/);
    const empty = loaded("{}");
    for (const text of ["5", "[]", '"abc"', '""', "true"]) expect(loaded(text), text).toBe(empty);
  });
});

describe.runIf(run)("EX-3: a number past the double range", () => {
  it("is refused by the engine, and the largest doubles still load", () => {
    const save = tower();
    const withMoney = (literal: string): string => save.replace(/"money":[^,]+,/, `"money":${literal},`);
    const text = withMoney("1e400");
    expect(text).toContain('"money":1e400,');
    expect(() => rust().Engine.fromSave(text)).toThrow(/number out of range/);
    expect((JSON.parse(loaded(withMoney("1e308"))) as { money: number }).money).toBe(1e308);
  });
});
