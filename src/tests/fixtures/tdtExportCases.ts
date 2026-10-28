/**
 * The export half of the TDT conformance table
 * (`src/tests/integration/tdtCases.integration.test.ts`): every serialized
 * tower the lock replays through `buildTDT`, as `[id, input]` where the
 * input is a full save or another case's save plus a top-level patch.
 */
import { SAVE_VERSION } from "../../engine/saveMigration";
import type { SerializedGame, Transport, Unit } from "../../engine/types";
import { buildTDT } from "../../storage/tdtExport";
import { parseTDT } from "../../storage/tdtImport";
import { buildTdt, sampleTowerSpec } from "./tdtBuilder";

function unit(partial: Partial<Unit> & Pick<Unit, "id" | "kind" | "floor" | "x" | "width">): Unit {
  return { state: "empty", satisfaction: 1, occupants: 0, everOccupied: false, pendingIncome: 0, label: "", ...partial };
}

function tower(units: Unit[], transports: Transport[] = [], extra: Partial<SerializedGame> = {}): SerializedGame {
  return {
    version: SAVE_VERSION,
    seed: 1,
    money: 2_000_000,
    star: 2,
    minutes: 7 * 60,
    mode: "classic",
    units,
    transports,
    nextId: units.length + transports.length + 1,
    towerName: "Lock",
    builtWeddingHall: false,
    evaluatedTower: false,
    ...extra,
  };
}

function shaft(over: Partial<Transport> = {}): Transport {
  return { id: 10, kind: "elevatorStandard", x: 20, width: 4, bottom: 1, top: 9, cars: 1, carPositions: [1], carDir: [0], load: 0, ...over };
}

function flight(id: number, kind: "stairs" | "escalator", x: number, bottom: number): Transport {
  return { id, kind, x, width: 8, bottom, top: bottom + 1, cars: 0, carPositions: [], carDir: [], load: 0 };
}

/** A value a forged save can carry that the type never allows: `null` where a
 *  NaN crossed JSON, or a string where a number belongs. The exporter reads
 *  these with `Number.isFinite` (no coercion), and the lock pins that. */
function forged<T>(value: unknown): T {
  return value as T;
}

/** The sample fixture pulled through the importer: rooms, hotel states,
 *  transports and paving in the shape the live game serializes. */
function sampleSave(): SerializedGame {
  return parseTDT(buildTdt(sampleTowerSpec()).buffer as ArrayBuffer, "SAMPLE.TDT").save;
}

function pavedTower(): SerializedGame {
  const units: Unit[] = [];
  let id = 1;
  const paveRow = (kind: "floor" | "lobby", floor: number, from: number, to: number) => {
    for (let x = from; x < to; x++) units.push(unit({ id: id++, kind, floor, x, width: 1 }));
  };
  paveRow("lobby", 1, 0, 10);
  paveRow("lobby", 15, 0, 10);
  paveRow("floor", 2, 0, 20);
  units.push(unit({ id: id++, kind: "office", floor: 2, x: 0, width: 9, state: "occupied" }));
  units.push(unit({ id: id++, kind: "office", floor: 2, x: 11, width: 9, state: "occupied" }));
  return tower(units);
}

export type ExportInput = { save: SerializedGame } | { base: string; patch: Partial<SerializedGame> };

export function exportInputs(): [string, ExportInput][] {
  const out: [string, ExportInput][] = [];
  const add = (id: string, save: SerializedGame) => out.push([id, { save }]);
  const variant = (id: string, patch: Partial<SerializedGame>) => out.push([id, { base: "sample", patch }]);
  add("sample", sampleSave());
  add("sample-reimport", parseTDT(buildTDT(sampleSave()).bytes.buffer as ArrayBuffer, "S.TDT").save);
  variant("sample-modern", { mode: "modern" });
  variant("sample-view", { view: { tile: 187.5, floor: 3.25 } });
  variant("sample-view-extreme", { view: { tile: -50, floor: 120 } });
  variant("sample-view-origin", { view: { tile: 40, floor: 109 } });
  variant("sample-last-quarter", { lastQuarterMoney: 1_500_000 });
  variant("sample-star-9", { star: 9.7 });
  variant("sample-money-huge", { money: 1e15 });
  variant("sample-money-null", { money: Number.NaN });
  variant("sample-midnight", { minutes: 5 * 1440 });
  variant("sample-noon-day-3", { minutes: 3 * 1440 + 12 * 60 + 15 });
  variant("sample-skipper-first", {
    transports: [
      ...sampleSave().transports,
      { id: 200, kind: "elevatorStandard", x: 100, width: 4, bottom: 1, top: 12, cars: 2, carPositions: [1, 1], carDir: [0, 0], load: 0, skipFloors: [4, 5, 6, 7, 8] },
      { id: 201, kind: "elevatorService", x: 120, width: 4, bottom: 2, top: 9, cars: 3, carPositions: [2, 2, 2], carDir: [0, 0, 0], load: 0 },
    ],
  });
  add("paved", pavedTower());
  add("paved-reimport", parseTDT(buildTDT(pavedTower()).bytes.buffer as ArrayBuffer, "P.TDT").save);
  {
    const units: Unit[] = [unit({ id: 1, kind: "lobby", floor: 1, x: 100, width: 1, state: "occupied" })];
    for (let i = 0; i < 4; i++) units.push(unit({ id: 10 + i, kind: "floor", floor: 2 + i, x: 100, width: 9 }));
    add("golden-length", {
      version: SAVE_VERSION, seed: 1, money: 1_000_000, star: 1, minutes: 600, mode: "classic",
      units, nextId: 100, towerName: "GOLD", builtWeddingHall: false, evaluatedTower: false,
      transports: [{ id: 50, kind: "elevatorStandard", x: 90, width: 4, bottom: 1, top: 8, cars: 2, carPositions: [1, 1], carDir: [0, 0], load: 0, skipFloors: [3, 4] }],
    });
  }
  add("empty-lobby", tower([unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })]));
  add("no-units", tower([]));
  add("retail-subtypes", tower([
    unit({ id: 1, kind: "shop", floor: 2, x: 0, width: 12, state: "occupied", subtype: "Book Store" }),
    unit({ id: 2, kind: "fastFood", floor: 2, x: 12, width: 16, state: "occupied", subtype: "Chinese Cafe" }),
    unit({ id: 3, kind: "restaurant", floor: 2, x: 28, width: 24, state: "occupied", subtype: "Steak House" }),
    unit({ id: 4, kind: "shop", floor: 2, x: 52, width: 12, state: "empty" }),
    unit({ id: 5, kind: "shop", floor: 2, x: 64, width: 12, state: "occupied", subtype: "Not A Shop" }),
  ]));
  add("rent-classes", tower([
    unit({ id: 1, kind: "office", floor: 2, x: 0, width: 9, rent: 2_000 }),
    unit({ id: 2, kind: "office", floor: 2, x: 9, width: 9, rent: 5_000 }),
    unit({ id: 3, kind: "office", floor: 2, x: 18, width: 9 }),
    unit({ id: 4, kind: "office", floor: 2, x: 27, width: 9, rent: 15_000 }),
    unit({ id: 5, kind: "office", floor: 2, x: 36, width: 9, rent: 7_500 }),
    unit({ id: 6, kind: "office", floor: 2, x: 45, width: 9, rent: 12_345, noRate: true }),
    unit({ id: 7, kind: "shop", floor: 2, x: 54, width: 12, noRate: true }),
    unit({ id: 8, kind: "condo", floor: 3, x: 0, width: 16, rent: 200_000, state: "occupied", everOccupied: true, residents: 4 }),
    unit({ id: 9, kind: "hotelSuite", floor: 4, x: 0, width: 10, rent: 9_000, state: "asleep", occupants: 2 }),
    unit({ id: 10, kind: "hotelSingle", floor: 4, x: 10, width: 4, state: "dirty" }),
    unit({ id: 11, kind: "hotelDouble", floor: 4, x: 14, width: 6, everOccupied: true }),
    unit({ id: 12, kind: "hotelSingle", floor: 4, x: 20, width: 4, state: "asleep", occupants: 9 }),
  ]));
  add("states", tower([
    unit({ id: 1, kind: "office", floor: 2, x: 0, width: 9, state: "vacating", label: "Acme" }),
    unit({ id: 2, kind: "office", floor: 2, x: 9, width: 9, state: "moving_in" }),
    unit({ id: 3, kind: "office", floor: 2, x: 18, width: 9, state: "empty", everOccupied: true }),
    unit({ id: 4, kind: "office", floor: 2, x: 27, width: 9, state: "construction" }),
    unit({ id: 5, kind: "office", floor: 2, x: 36, width: 9, state: "fire" }),
    unit({ id: 6, kind: "office", floor: 2, x: 45, width: 9, state: "gutted" }),
    unit({ id: 7, kind: "condo", floor: 3, x: 0, width: 16, state: "occupied", residents: Number.NaN }),
    unit({ id: 8, kind: "fastFood", floor: 3, x: 16, width: 16, state: "occupied" }),
    unit({ id: 9, kind: "fastFood", floor: 3, x: 32, width: 16, state: "empty" }),
    unit({ id: 10, kind: "lobby", floor: 1, x: 0, width: 40, state: "gutted" }),
    unit({ id: 11, kind: "cinema", floor: 5, x: 0, width: 31, state: "fire" }),
  ]));
  add("header-counts", tower([
    unit({ id: 1, kind: "recycling", floor: -2, x: 0, width: 20 }),
    unit({ id: 2, kind: "recycling", floor: -4, x: 0, width: 20 }),
    unit({ id: 3, kind: "security", floor: 2, x: 0, width: 8 }),
    unit({ id: 4, kind: "medical", floor: 2, x: 8, width: 8 }),
    unit({ id: 5, kind: "partyHall", floor: 3, x: 0, width: 20 }),
    unit({ id: 6, kind: "cinema", floor: 5, x: 0, width: 31 }),
    unit({ id: 7, kind: "metro", floor: -9, x: 0, width: 60 }),
    unit({ id: 8, kind: "housekeeping", floor: 2, x: 16, width: 8 }),
    ...Array.from({ length: 12 }, (_, i) => unit({ id: 20 + i, kind: "security", floor: 7 + i, x: 0, width: 8 })),
  ]));
  add("wedding-hall", tower([
    unit({ id: 1, kind: "weddingHall", floor: 100, x: 100, width: 16 }),
    unit({ id: 2, kind: "office", floor: 97, x: 100, width: 9 }),
  ]));
  add("wedding-hall-cinema-below", tower([
    unit({ id: 1, kind: "weddingHall", floor: 100, x: 100, width: 16 }),
    unit({ id: 2, kind: "cinema", floor: 97, x: 100, width: 31 }),
  ]));
  add("wedding-hall-burned-below", tower([
    unit({ id: 1, kind: "weddingHall", floor: 100, x: 100, width: 16 }),
    unit({ id: 2, kind: "office", floor: 98, x: 100, width: 9, state: "gutted" }),
  ]));
  add("wide-floor-order", tower([
    unit({ id: 1, kind: "floor", floor: 2, x: 0, width: 60 }),
    unit({ id: 2, kind: "office", floor: 2, x: 40, width: 9 }),
    unit({ id: 3, kind: "office", floor: 2, x: 5, width: 9 }),
    unit({ id: 4, kind: "lobby", floor: 1, x: 0, width: 60 }),
  ]));
  add("forged-coordinates", tower([
    unit({ id: 1, kind: "office", floor: 2, x: -1, width: 9 }),
    unit({ id: 2, kind: "office", floor: 2, x: 370, width: 9 }),
    unit({ id: 3, kind: "office", floor: 2, x: 3.7, width: 9 }),
    unit({ id: 4, kind: "floor", floor: 3, x: 0, width: Number.POSITIVE_INFINITY }),
    unit({ id: 5, kind: "office", floor: 3, x: 400, width: 9, state: "gutted" }),
    unit({ id: 6, kind: "office", floor: 101, x: 0, width: 9 }),
    unit({ id: 7, kind: "cinema", floor: 100, x: 0, width: 31 }),
    unit({ id: 8, kind: "office", floor: -20, x: 0, width: 9 }),
  ]));
  add("parking", tower([
    unit({ id: 1, kind: "parkingRamp", floor: -1, x: 100, width: 16 }),
    unit({ id: 2, kind: "parking", floor: -1, x: 116, width: 4 }),
    unit({ id: 3, kind: "parking", floor: -1, x: 120, width: 4 }),
    unit({ id: 4, kind: "parking", floor: -1, x: 130, width: 4 }),
    unit({ id: 5, kind: "parking", floor: -1, x: 96, width: 4 }),
    unit({ id: 6, kind: "parking", floor: -2, x: 100, width: 4 }),
    unit({ id: 7, kind: "parking", floor: -1, x: 92, width: 4, state: "gutted" }),
  ]));
  add("transports", tower(
    [unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })],
    [
      shaft({ id: 10, kind: "elevatorExpress", x: 10, bottom: 1, top: 60, cars: 8, carPositions: [1, 15, 30, 45, 60, 2, 3, 4], skipFloors: [2, 3, 4, 1, 60, 5.5] }),
      shaft({ id: 11, kind: "elevatorStandard", x: 20, bottom: 1, top: 9, cars: 9, carPositions: [1, 2, 3] }),
      shaft({ id: 12, kind: "elevatorService", x: 30, bottom: -3, top: 40, cars: 0, carPositions: [] }),
      shaft({ id: 13, kind: "elevatorStandard", x: 40, bottom: 5, top: 5 }),
      shaft({ id: 14, kind: "elevatorStandard", x: 900, bottom: -20, top: 2, cars: 2.6, carPositions: [-30, 300] }),
      shaft({ id: 15, kind: "elevatorExpress", x: 50, bottom: 1, top: 100, cars: 8 }),
      shaft({ id: 16, kind: "elevatorStandard", x: 60, bottom: 2.4, top: 9.6, cars: 3 }),
      flight(20, "stairs", 100, 1),
      flight(21, "stairs", 100, 2),
      flight(22, "stairs", 100, 3),
      flight(23, "stairs", 100, 4),
      flight(24, "escalator", 120, 1),
      flight(25, "escalator", 120, 3),
      flight(26, "stairs", 140, -9),
      flight(27, "stairs", 140, 100),
      flight(28, "stairs", 380, 1),
      flight(29, "stairs", 150, 1.5),
      flight(30, "stairs", 102, 1),
    ],
  ));
  add("transports-pool-caps", tower(
    [unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })],
    [
      ...Array.from({ length: 27 }, (_, i) => shaft({ id: 10 + i, kind: i % 9 === 0 ? "elevatorExpress" : "elevatorStandard", x: i * 4, bottom: 1, top: 9 })),
      ...Array.from({ length: 70 }, (_, i) => flight(100 + i, "stairs", (i % 35) * 10, 1 + Math.floor(i / 35) * 3)),
    ],
  ));
  add("narrow-shaft-collision", tower(
    [unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })],
    [shaft({ id: 10, x: 20, width: 3 }), shaft({ id: 11, x: 23, width: 3 })],
  ));
  add("tenant-ceiling", tower(Array.from({ length: 256 }, (_, i) => unit({ id: 1 + i, kind: "office", floor: 2, x: i, width: 1 }))));
  add("tenant-ceiling-over", tower(Array.from({ length: 257 }, (_, i) => unit({ id: 1 + i, kind: "office", floor: 2, x: i, width: 1 }))));
  add("census", tower([
    unit({ id: 1, kind: "office", floor: 2, x: 0, width: 9, state: "occupied" }),
    unit({ id: 2, kind: "condo", floor: 3, x: 0, width: 16, state: "occupied", residents: 5 }),
    unit({ id: 3, kind: "hotelSingle", floor: 4, x: 0, width: 4, state: "asleep", occupants: 1 }),
    unit({ id: 4, kind: "restaurant", floor: 5, x: 0, width: 24, state: "occupied" }),
    unit({ id: 5, kind: "shop", floor: 5, x: 24, width: 12, state: "vacating" }),
    unit({ id: 6, kind: "cinema", floor: 6, x: 0, width: 31, state: "occupied" }),
  ]));
  // Non-number values at the sites the exporter guards with `Number.isFinite`
  // or a `Set`: a `null` (a NaN that crossed JSON) or a string must read as
  // "not a finite number" there, never coerce through `Number()` (#882).
  variant("sample-view-tile-null", { view: { tile: forged(null), floor: 3 } });
  variant("sample-view-floor-null", { view: { tile: 5, floor: forged(null) } });
  variant("sample-money-string", { money: forged("1000000") });
  variant("sample-star-string", { star: forged("3") });
  variant("sample-last-quarter-string", { lastQuarterMoney: forged("150000") });
  const lobbyOnly = [unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })];
  add("shaft-bottom-null", tower(lobbyOnly, [shaft({ bottom: forged(null), top: 9 })]));
  add("shaft-top-null", tower(lobbyOnly, [shaft({ bottom: -3, top: forged(null) })]));
  add("walkway-bottom-null", tower(lobbyOnly, [{ ...flight(20, "stairs", 100, 1), bottom: forged(null) }]));
  add("shaft-cars-string", tower(lobbyOnly, [shaft({ cars: forged("3") })]));
  add("shaft-car-position-null", tower(lobbyOnly, [shaft({ bottom: -3, top: 9, carPositions: [forged(null), 5] })]));
  add("shaft-skip-null", tower(lobbyOnly, [shaft({ bottom: -3, top: 9, skipFloors: [forged(null), 2] })]));
  add("shaft-skip-string", tower(lobbyOnly, [shaft({ bottom: 1, top: 9, skipFloors: [forged("4"), 5] })]));
  add("residents-string", tower([
    ...lobbyOnly,
    unit({ id: 2, kind: "condo", floor: 3, x: 0, width: 16, state: "occupied", residents: forged("5") }),
  ]));
  add("burned-x-null", tower([
    ...lobbyOnly,
    unit({ id: 2, kind: "office", floor: 2, x: forged(null), width: 9, state: "gutted" }),
    unit({ id: 3, kind: "office", floor: 3, x: forged(null), width: 9 }),
  ]));
  // Forged shapes the TypeScript exporter used to throw a TypeError on, or loop
  // forever on, where the Rust codec refuses, drops or stops (#887). The
  // agreed answer is the Rust one.
  const reshaped = (patch: Record<string, unknown>, drop: string[] = []): SerializedGame => {
    const save: Record<string, unknown> = { ...tower(lobbyOnly), ...patch };
    for (const key of drop) delete save[key];
    return forged(save);
  };
  add("forged-units-missing", reshaped({}, ["units"]));
  add("forged-units-null", reshaped({ units: null }));
  add("forged-units-empty-string", reshaped({ units: "" }));
  add("forged-units-string", reshaped({ units: "lobby" }));
  add("forged-units-object", reshaped({ units: { 0: lobbyOnly[0] } }));
  add("forged-transports-missing", reshaped({}, ["transports"]));
  add("forged-transports-null", reshaped({ transports: null }));
  add("forged-transports-string", reshaped({ transports: "shaft" }));
  add("forged-transport-entries", tower(lobbyOnly, forged([null, 7, "shaft", [1, 2], {}, true, shaft({ id: 11 })])));
  add("forged-unit-entry-null", tower(forged([...lobbyOnly, null])));
  add("forged-unit-entry-number", tower(forged([...lobbyOnly, 7])));
  add("forged-unit-entry-string", tower(forged([...lobbyOnly, "office"])));
  add("forged-unit-entry-array", tower(forged([...lobbyOnly, ["office", 2]])));
  const room = { id: 2, floor: 2, x: 0, width: 9 };
  add("forged-unit-kind-missing", tower(forged([...lobbyOnly, room])));
  add("forged-unit-kind-null", tower(forged([...lobbyOnly, { ...room, kind: null }])));
  add("forged-unit-kind-number", tower(forged([...lobbyOnly, { ...room, kind: 5 }])));
  add("forged-unit-kind-unknown", tower(forged([...lobbyOnly, { ...room, kind: "arcade" }])));
  add("forged-unit-kind-prototype", tower(forged([...lobbyOnly, { ...room, kind: "constructor" }])));
  // The refusal quotes the kind; JSON's quoting is what both sides write.
  add("forged-unit-kind-quoting", tower(forged([...lobbyOnly, { ...room, kind: 'say "hi" \\ \n\t\u0001\u007f\u2028 é 塔 🏢' }])));
  for (const [id, skipFloors] of [["true", true], ["number", 4], ["object", { 0: 4 }], ["string", "45"]] as const) {
    add(`forged-skip-floors-${id}`, tower(lobbyOnly, [shaft({ bottom: 1, top: 9, skipFloors: forged(skipFloors) })]));
  }
  for (const [id, carPositions] of [["true", true], ["object", { 0: 5, 1: 7 }], ["string", "57"], ["number", 5], ["null", null]] as const) {
    add(`forged-car-positions-${id}`, tower(lobbyOnly, [shaft({ bottom: 1, top: 9, cars: 2, carPositions: forged(carPositions) })]));
  }
  // A two-story room past 2^53: `floor + 1` is `floor`, and the story walk
  // still ends.
  for (const floor of [2 ** 53, 2 ** 60, Number.MAX_VALUE]) {
    add(`forged-two-story-floor-${floor}`, tower([...lobbyOnly, unit({ id: 2, kind: "cinema", floor, x: 0, width: 31 })]));
  }
  // A floor whose steps round just under `floor + stories`: the walk widens
  // one more floor on both sides.
  for (const floor of [3e-16, -3.17e-16]) {
    add(`forged-two-story-floor-${floor}`, tower([...lobbyOnly, unit({ id: 2, kind: "cinema", floor, x: 0, width: 31 })]));
  }
  add("forged-three-story-floor-2.28e-16", tower([...lobbyOnly, unit({ id: 2, kind: "metro", floor: 2.28e-16, x: 0, width: 375 })]));
  add("forged-name-missing", reshaped({}, ["towerName"]));
  add("forged-name-number", reshaped({ towerName: 5 }));
  // The null JSON writes for a NaN or an Infinity at the fields the TypeScript
  // exporter once read differently from null: the clock, an asleep hotel
  // room's occupants, an office's rent.
  const asleep = (over: Record<string, unknown>) =>
    tower(forged([...lobbyOnly, { ...unit({ id: 2, kind: "hotelSingle", floor: 2, x: 0, width: 4, state: "asleep", occupants: 1 }), ...over }]));
  const rented = (over: Record<string, unknown>) =>
    tower(forged([...lobbyOnly, { ...unit({ id: 2, kind: "office", floor: 2, x: 0, width: 9, state: "occupied" }), ...over }]));
  add("forged-minutes-null", reshaped({ minutes: null }));
  add("forged-occupants-null", asleep({ occupants: null }));
  add("forged-rent-null", rented({ rent: null }));
  // An object with its own `toString` key: JavaScript cannot convert it, and
  // both sides read it as NaN where a number belongs and as no kind.
  const noString = { toString: 0 };
  add("forged-to-string-minutes", reshaped({ minutes: noString }));
  add("forged-to-string-occupants", asleep({ occupants: noString }));
  add("forged-to-string-rent", rented({ rent: [noString] }));
  add("forged-to-string-transport-kind", tower(lobbyOnly, [shaft({ kind: forged(noString) })]));
  add("forged-to-string-unit-kind", tower(forged([...lobbyOnly, { ...room, kind: noString }])));
  // Transport kinds no table holds: a prototype key, and a kind in a list.
  add("forged-transport-kind-prototype", tower(lobbyOnly, [shaft({ kind: forged("constructor") })]));
  add("forged-transport-kind-list", tower(lobbyOnly, [shaft({ kind: forged(["elevatorStandard"]) })]));
  // A stall with no x reads NaN; both sides sort it after every number. The
  // first list is one the old Rust sort ordered differently, the second one
  // both old sorts did.
  add("forged-parking-x-missing", tower([
    unit({ id: 1, kind: "parking", floor: -1, x: 5, width: 4 }),
    unit({ id: 2, kind: "parking", floor: -1, x: 3, width: 4 }),
    forged({ id: 3, kind: "parking", floor: -1, width: 4 }),
    unit({ id: 4, kind: "parkingRamp", floor: -1, x: 1, width: 2 }),
  ]));
  add("forged-parking-x-missing-twice", tower([
    forged({ id: 1, kind: "parkingRamp", floor: -1, width: 2 }),
    unit({ id: 2, kind: "parkingRamp", floor: -1, x: 1, width: 4 }),
    unit({ id: 3, kind: "parking", floor: -1, x: 9, width: 2 }),
    forged({ id: 4, kind: "parking", floor: -1, width: 4 }),
    unit({ id: 5, kind: "parking", floor: -1, x: 4, width: 2 }),
    forged({ id: 6, kind: "parking", floor: -1, width: 2 }),
    unit({ id: 7, kind: "parkingRamp", floor: -1, x: 4, width: 2 }),
  ]));
  // A catalog kind of the wrong family, and two forgeries at once: the unit
  // kind is refused before the transport list is read, and Modern rules
  // before the unit list.
  add("forged-unit-kind-transport", tower(forged([...lobbyOnly, { ...room, kind: "elevatorExpress" }])));
  add("forged-refusal-order", reshaped({ units: [...lobbyOnly, { ...room, kind: "arcade" }], transports: "shaft" }));
  add("forged-refusal-order-modern", reshaped({ mode: "modern", units: null }));
  return out;
}
