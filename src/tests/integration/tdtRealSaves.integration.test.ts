/**
 * Nine real SimTower saves from 1997, contributed by Reddit user u/invokes with
 * their consent (r/SimTower thread, 2026-10-29). They are the first real saves
 * of that vintage the importer has met; see
 * `conformance/fixtures/tdt-reddit/README.md` and issue #1491. The Rust importer
 * reads the same files in `engine-rs/tests/tdt_real_saves.rs` and must agree.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { describeWithCodec, parseTDT } from "../conformance/tdtWasm";
import { wasm } from "../conformance/wasmEngine";
import type { SerializedGame } from "../../shared/types";

const DIR = resolve(__dirname, "../../../conformance/fixtures/tdt-reddit");
const load = (name: string) => {
  const bytes = readFileSync(resolve(DIR, name));
  return parseTDT(bytes, name);
};

/** The app version and save time a test `.vctower` is stamped with. */
const APP_VERSION = "3.0.0";
const SAVED_AT_MS = 0;

/** A save loaded on the Rust engine and written back, as the game keeps it. */
function loaded(save: SerializedGame): SerializedGame {
  const engine = wasm().Engine.fromSave(JSON.stringify(save));
  try {
    return JSON.parse(engine.serialize()) as SerializedGame;
  } finally {
    engine.free();
  }
}

/** The record status the engine's commands answer with when they succeed. */
const DONE = 1;

/** A `.TDT` file imported the way the game does it: the engine reads the file
 *  (`loadTdt`), then adopts the tower (`adoptTdt`). */
function imported(name: string): SerializedGame {
  const engine = wasm().Engine.newGame(1, "classic");
  try {
    expect(engine.loadTdt(readFileSync(resolve(DIR, name)), name)[0], engine.lastReason()).toBe(DONE);
    expect(engine.adoptTdt()[0], engine.lastReason()).toBe(DONE);
    return JSON.parse(engine.serialize()) as SerializedGame;
  } finally {
    engine.free();
  }
}

/** A save through a `.vctower` file and back: the Rust engine writes it and
 *  opens the file again. */
function throughVctower(save: SerializedGame): SerializedGame {
  const encode = wasm().encodeVctower;
  if (!encode) throw new Error("the WASM binding exports no encodeVctower; rebuild it");
  const file = encode(JSON.stringify(loaded(save)), APP_VERSION, SAVED_AT_MS);
  const engine = wasm().Engine.fromVctower(file);
  try {
    return JSON.parse(engine.serialize()) as SerializedGame;
  } finally {
    engine.free();
  }
}

/** Shafts and walkway flights each save carries. Every file reads straight
 *  through its elevator table, express shafts included (#1491, #1497). */
const SAVES = [
  { name: "TOWER1.TDT", shafts: 15, flights: 1 },
  { name: "TOWER2.TDT", shafts: 24, flights: 30 },
  { name: "TOWER3.TDT", shafts: 11, flights: 29 },
  { name: "TOWER4.TDT", shafts: 18, flights: 29 },
  { name: "TOWER5.TDT", shafts: 7, flights: 7 },
  { name: "TOWER6.TDT", shafts: 23, flights: 64 },
  { name: "TOWER7.TDT", shafts: 24, flights: 64 },
  { name: "TOWER8.TDT", shafts: 0, flights: 0 },
  { name: "MYTOWER.TDT", shafts: 24, flights: 37 },
] as const;

describeWithCodec("real 1997 saves (u/invokes)", () => {
  for (const { name, shafts, flights } of SAVES) {
    it(`${name} brings over its own elevators and stairways`, () => {
      const { save, report } = load(name);
      const walkways = save.transports.filter((t) => t.kind === "stairs" || t.kind === "escalator").length;
      expect(save.transports.length - walkways).toBe(shafts);
      expect(walkways).toBe(flights);
      const said = [...report.broughtOver, ...report.couldNotBring].join(" ");
      expect(said).not.toMatch(/rebuilt from your floors/);
      expect(said).not.toMatch(/stairways couldn't be read/);
      expect(report.couldNotBring.some((l) => l.includes("found by searching the file"))).toBe(false);
    });
  }
});

describeWithCodec("real 1997 saves keep their shop, restaurant and fast-food styles through a .vctower", () => {
  const STYLED = new Set(["shop", "restaurant", "fastFood"]);
  const styles = (units: { kind: string; floor: number; x: number; subtype?: string }[]) =>
    units
      .filter((u) => STYLED.has(u.kind))
      .map((u) => `${u.kind}@${u.floor},${u.x}=${u.subtype}`)
      .sort();

  for (const { name } of SAVES) {
    it(`${name}: import .TDT, save .vctower, reload`, () => {
      const imported = load(name).save;
      const before = styles(imported.units);
      const reloaded = throughVctower(imported);
      expect(styles(reloaded.units)).toEqual(before);
      // Every styled room has a style, so the comparison above is not empty names.
      expect(before.every((line) => !line.endsWith("=undefined"))).toBe(true);
    });
  }
});


describeWithCodec("imported TDT basement express stop persistence", () => {
  it("marks real TDT basement express stops and keeps them on ordinary .vctower reload", () => {
    const source = load("TOWER7.TDT").save;
    const fromGame = imported("TOWER7.TDT");
    const shafts = source.transports.filter((t) => t.kind === "elevatorExpress" && t.bottom < 0 && Array.isArray(t.skipFloors));
    expect(shafts.length).toBeGreaterThan(0);
    for (const fromFile of shafts) {
      const actual = fromGame.transports.find((t) =>
        t.kind === fromFile.kind && t.x === fromFile.x && t.bottom === fromFile.bottom && t.top === fromFile.top);
      expect(actual?.preserveBasementStops).toBe(true);
      for (let floor = fromFile.bottom + 1; floor <= 0; floor++) {
        expect(actual?.skipFloors?.includes(floor)).toBe(fromFile.skipFloors!.includes(floor));
      }
    }
    const reloaded = throughVctower(fromGame);
    for (const t of fromGame.transports.filter((t) => t.preserveBasementStops)) {
      const again = reloaded.transports.find((s) => s.id === t.id);
      expect(again?.preserveBasementStops).toBe(true);
      expect(again?.skipFloors).toEqual(t.skipFloors);
    }
  });

  it("preserves zero/mixed skips twice without changing older or Modern saves", () => {
    const source = load("TOWER7.TDT").save;
    const index = source.transports.findIndex((t) =>
      t.kind === "elevatorExpress" && t.bottom <= -2 && t.top > 4);
    expect(index).toBeGreaterThanOrEqual(0);
    const original = source.transports[index];
    const baseline = original.bottom + 1;
    const sky = original.top - 1;
    for (const skips of [[], [baseline, sky], [sky]]) {
      const raw = structuredClone(source);
      raw.transports[index].skipFloors = skips;
      raw.transports[index].preserveBasementStops = true;
      const sim = loaded(raw);
      const before = sim.transports.find((t) => t.id === original.id);
      expect(before?.preserveBasementStops).toBe(true);
      for (let fl = original.bottom + 1; fl <= 0; fl++) {
        expect(before?.skipFloors?.includes(fl)).toBe(skips.includes(fl));
      }
      const first = throughVctower(sim);
      const second = throughVctower(first);
      for (const roundTrip of [first, second]) {
        const after = roundTrip.transports.find((t) => t.id === original.id);
        expect(after?.skipFloors).toEqual(before?.skipFloors);
        expect(after?.preserveBasementStops).toBe(true);
      }
    }
    const legacy = structuredClone(source);
    legacy.transports[index].skipFloors = [sky];
    const oldShaft = loaded(legacy).transports.find((t) => t.id === original.id);
    expect(oldShaft?.preserveBasementStops).toBeUndefined();
    expect(oldShaft?.skipFloors).toContain(baseline);
    legacy.mode = "modern";
    legacy.transports[index].preserveBasementStops = true;
    const modern = loaded(legacy).transports.find((t) => t.id === original.id);
    expect(modern?.preserveBasementStops).toBeUndefined();
    expect(modern?.skipFloors).toContain(baseline);
  });
});
