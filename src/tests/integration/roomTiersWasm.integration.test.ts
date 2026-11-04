import { afterEach, describe, expect, it } from "vitest";
import { facilityFloors } from "../../engine/facilities";
import type { GameMode, UnitState } from "../../engine/types";
import type { EnginePort, PortRecord } from "../../simport/enginePort";
import { EVAL_TIERS, RENT_TIERS, RoomTierReader, type EvalTier, type RentTier, type RoomTiers } from "../../simport/roomTiers";
import { ViewReader } from "../../simport/viewReader";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The rooms' evaluation and rent tiers through the real engine package
 * (#343 S7): the port's `roomTiers` record, read by `RoomTierReader`, lines up
 * with the view's rooms, follows the engine's cut points and price ladders,
 * moves with the rent commands, and rates exactly the rooms the Satisfaction
 * heatmap draws. The towers are built through the port's own commands, and a
 * room's state and score are set through its save, as a saved tower carries
 * them; the TypeScript engine has no Map views and is not involved.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type RustEngine = EnginePort & { free(): void; setMoney(amount: number): void };
const freed: RustEngine[] = [];
/** A command record's status slot when the command applied (the rule
 *  `outcome` in `src/simport/portCodes.ts` reads as `ok`). */
const APPLIED = 1;
afterEach(() => {
  for (const e of freed.splice(0)) e.free();
});

/** The engine's own lines, which the tiers cut at: below the first a tenant
 *  on notice leaves, and at or below the second is the inspector's gripe
 *  check (`names_gripe`). */
const KEEP_LINE = 0.4;
const GRIPE_LINE = 0.6;

/** The parts of the view layout these tests read. */
interface Layout {
  readonly kinds: readonly string[];
  readonly heatModes: readonly string[];
  readonly evalTiers: readonly string[];
  readonly rentTiers: readonly string[];
  readonly records: Readonly<Record<string, readonly string[]>>;
}

const layoutOf = (port: EnginePort): Layout => JSON.parse(port.viewLayout()) as Layout;

/** Slot `name` of record `op`, by the layout's names. */
function slotOf(l: Layout, op: string, rec: PortRecord, name: string): number {
  const at = l.records[op].indexOf(name);
  if (at < 0) throw new Error(`${op} has no slot ${name}`);
  return rec[at];
}

/** The parts of a save these tests edit. */
interface SavedTower {
  star: number;
  units: { kind: string; floor: number; x: number; state?: UnitState; satisfaction?: number }[];
}

/** Open the engine's save, edit it, and load the result, as a saved tower
 *  loads. */
function edit(port: EnginePort, change: (save: SavedTower) => void): void {
  const save = JSON.parse(port.serialize()) as SavedTower;
  change(save);
  expect(port.loadSave(JSON.stringify(save))[0], "the engine loads the edited save").toBe(APPLIED);
}

interface Room {
  readonly kind: "office" | "hotelSingle" | "fastFood" | "security" | "condo";
  readonly floor: number;
  readonly x: number;
  readonly state?: UnitState;
  readonly satisfaction?: number;
}

/** A three-star tower on a lobby and two floors, with the given rooms built
 *  through the port and their state and score set through the save. */
function towerWith(mode: GameMode, rooms: readonly Room[]): RustEngine {
  const rust = wasm().Engine.newGame(11, mode) as unknown as RustEngine;
  freed.push(rust);
  edit(rust, (save) => {
    save.star = 3;
  });
  rust.setMoney(1e9);
  const l = layoutOf(rust);
  const kind = (name: string): number => l.kinds.indexOf(name);
  const build = (name: string, floor: number, x: number): void => {
    const rec = rust.buildAt(kind(name), floor, x);
    expect(slotOf(l, "buildAt", rec, "status"), `${name} at ${floor},${x}: ${rust.lastReason() ?? ""}`).toBe(APPLIED);
  };
  for (let x = 150; x < 260; x++) build("lobby", 1, x);
  for (const floor of [2, 3]) for (let x = 151; x < 259; x++) build("floor", floor, x);
  for (const r of rooms) build(r.kind, r.floor, r.x);
  edit(rust, (save) => {
    for (const r of rooms) {
      const u = save.units.find((unit) => unit.kind === r.kind && unit.floor === r.floor && unit.x === r.x);
      if (!u) throw new Error(`no ${r.kind} at ${r.floor},${r.x}`);
      if (r.state) u.state = r.state;
      if (r.satisfaction !== undefined) u.satisfaction = r.satisfaction;
    }
  });
  return rust;
}

interface Row {
  readonly id: number;
  readonly floor: number;
  readonly x: number;
  readonly evalTier: EvalTier;
  readonly rentTier: RentTier;
}

function rows(t: RoomTiers): Row[] {
  return Array.from({ length: t.size }, (_, i) => ({ id: t.id(i), floor: t.floor(i), x: t.x(i), evalTier: t.evalTier(i), rentTier: t.rentTier(i) }));
}

function tierAt(all: readonly Row[], floor: number, x: number): Row | undefined {
  return all.find((r) => r.floor === floor && r.x === x);
}

/** The anchor of each cell the Satisfaction heatmap draws, read through the
 *  port's `heatCells`. */
function satisfactionCells(port: EnginePort): string[] {
  const l = layoutOf(port);
  const width = l.records.heatCell.length;
  const r = port.heatCells(l.heatModes.indexOf("satisfaction"));
  const cells: string[] = [];
  for (let i = 0; i + width <= r.length; i += width) {
    const cell = r.subarray(i, i + width);
    cells.push(`${slotOf(l, "heatCell", cell, "floor")},${slotOf(l, "heatCell", cell, "minX")}`);
  }
  return cells;
}

const scores: readonly [number, EvalTier][] = [
  [0, "terrible"],
  [KEEP_LINE - 0.05, "terrible"],
  [KEEP_LINE, "good"],
  [GRIPE_LINE, "good"],
  [GRIPE_LINE + 0.05, "excellent"],
  [1, "excellent"],
];

describe.skipIf(!hasWasmPackage())("roomTiers on the Rust engine", () => {
  it("names the same tiers the reader knows, so no code falls through", () => {
    const rust = towerWith("classic", []);
    const layout = layoutOf(rust);
    expect([...layout.evalTiers].sort()).toEqual([...EVAL_TIERS].sort());
    expect([...layout.rentTiers].sort()).toEqual([...RENT_TIERS].sort());
    expect([...layout.records.roomTier].sort()).toEqual(["evalTier", "floor", "id", "rentTier", "x"]);
    const reader = new RoomTierReader(rust);
    expect(reader.available).toBe(true);
    expect(reader.read().size).toBe(0);
  });

  it("lists rated and priced rooms in the view's room order, by id and anchor tile", () => {
    const rust = towerWith("modern", [
      { kind: "office", floor: 2, x: 160, state: "occupied", satisfaction: 0.9 },
      { kind: "security", floor: 2, x: 180 },
      { kind: "fastFood", floor: 3, x: 160, state: "occupied", satisfaction: 0.3 },
      { kind: "hotelSingle", floor: 3, x: 200 },
      { kind: "office", floor: 2, x: 220 },
    ]);
    const all = rows(new RoomTierReader(rust).read());
    const view = new ViewReader(rust, facilityFloors);
    const byId = new Map(view.rooms.map((u, i) => [u.id, { u, i }]));
    let last = -1;
    for (const r of all) {
      const hit = byId.get(r.id);
      expect(hit, `room ${r.id} is a view room`).toBeDefined();
      expect([hit!.u.floor, hit!.u.x]).toEqual([r.floor, r.x]);
      expect(hit!.i, "in the view's order").toBeGreaterThan(last);
      last = hit!.i;
    }
    expect(all.map((r) => `${r.floor},${r.x}`)).toEqual(["2,160", "3,160", "3,200", "2,220"]);
    expect(tierAt(all, 2, 160)).toMatchObject({ evalTier: "excellent", rentTier: "average" });
    expect(tierAt(all, 3, 160)).toMatchObject({ evalTier: "terrible", rentTier: "unpriced" });
    expect(tierAt(all, 3, 200)).toMatchObject({ evalTier: "unrated", rentTier: "average" });
    expect(tierAt(all, 2, 180), "a security office has neither tier").toBeUndefined();
  });

  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: cuts the evaluation at the engine's keep and gripe lines`, () => {
      const rooms = scores.map(([satisfaction], i) => ({ kind: "office" as const, floor: 2, x: 152 + i * 9, state: "occupied" as const, satisfaction }));
      const rust = towerWith(mode, [...rooms, { kind: "office", floor: 3, x: 152, state: "vacating", satisfaction: 0.5 }]);
      const all = rows(new RoomTierReader(rust).read());
      for (const [i, [score, want]] of scores.entries()) expect(tierAt(all, 2, rooms[i].x)?.evalTier, `satisfaction ${score}`).toBe(want);
      expect(tierAt(all, 3, 152)?.evalTier, "a tenant on notice is rated by its score").toBe("good");
    });
  }

  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: a room exactly on the keep line or the gripe line still reads Good after a save round trip`, () => {
      const rooms = [KEEP_LINE, GRIPE_LINE].map((satisfaction, i) => ({ kind: "office" as const, floor: 2, x: 160 + i * 20, state: "occupied" as const, satisfaction }));
      const saved = towerWith(mode, rooms).serialize();
      const reloaded = wasm().Engine.newGame(12, mode) as unknown as RustEngine;
      freed.push(reloaded);
      expect(reloaded.loadSave(saved)[0], "the saved tower loads").toBe(APPLIED);
      const units = (JSON.parse(reloaded.serialize()) as SavedTower).units;
      const all = rows(new RoomTierReader(reloaded).read());
      for (const r of rooms) {
        const u = units.find((unit) => unit.kind === r.kind && unit.floor === r.floor && unit.x === r.x);
        expect(u?.satisfaction, "the score survives the trip unrounded").toBe(r.satisfaction);
        expect(tierAt(all, r.floor, r.x)?.evalTier, `satisfaction ${r.satisfaction}`).toBe("good");
      }
    });
  }

  it("classic: the rent tier is the rung the editor shows, and follows the rent commands", () => {
    const rust = towerWith("classic", [
      { kind: "office", floor: 2, x: 160 },
      { kind: "hotelSingle", floor: 3, x: 160 },
      { kind: "condo", floor: 3, x: 190 },
    ]);
    const reader = new RoomTierReader(rust);
    const before = rows(reader.read());
    for (const [floor, x] of [[2, 160], [3, 160], [3, 190]]) expect(tierAt(before, floor, x)?.rentTier, `${floor},${x} on the default`).toBe("average");
    const office = tierAt(before, 2, 160)!.id;
    const ladder: readonly [number, RentTier][] = [
      [2_000, "veryLow"],
      [5_000, "low"],
      [10_000, "average"],
      [15_000, "high"],
    ];
    for (const [price, want] of ladder) {
      expect(rust.setRent(office, price)[0], `set rent ${price}`).toBe(APPLIED);
      expect(tierAt(rows(reader.read()), 2, 160)?.rentTier, `rent ${price}`).toBe(want);
    }
    expect(rust.noRate(office)[0]).toBe(APPLIED);
    expect(tierAt(rows(reader.read()), 2, 160)?.rentTier).toBe("noRate");
  });

  it("modern: the rent tier follows the band around its neutral price", () => {
    const rust = towerWith("modern", [{ kind: "office", floor: 2, x: 160 }]);
    const reader = new RoomTierReader(rust);
    const office = rows(reader.read())[0].id;
    // The office band: 2,000 to 20,000 in steps of 1,000 around 10,000.
    const band: readonly [number, RentTier][] = [
      [11_000, "high"],
      [20_000, "high"],
      [9_000, "low"],
      [3_000, "low"],
      [2_000, "veryLow"],
      [10_000, "average"],
    ];
    for (const [price, want] of band) {
      expect(rust.setRent(office, price)[0], `set rent ${price}`).toBe(APPLIED);
      expect(rows(reader.read())[0].rentTier, `rent ${price}`).toBe(want);
    }
  });

  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: rates exactly the rooms the Satisfaction heatmap draws`, () => {
      const rust = towerWith(mode, [
        { kind: "office", floor: 2, x: 160, state: "occupied", satisfaction: 0.5 },
        { kind: "office", floor: 2, x: 200 },
        { kind: "hotelSingle", floor: 3, x: 160, state: "asleep", satisfaction: 0.8 },
        { kind: "hotelSingle", floor: 3, x: 180, state: "dirty" },
        { kind: "fastFood", floor: 3, x: 200, state: "occupied", satisfaction: 0.2 },
        { kind: "security", floor: 2, x: 230, state: "occupied" },
      ]);
      const rated = rows(new RoomTierReader(rust).read())
        .filter((r) => r.evalTier !== "unrated")
        .map((r) => `${r.floor},${r.x}`);
      expect(rated).toEqual(satisfactionCells(rust));
      expect(rated).toEqual(["2,160", "3,160", "3,200"]);
    });
  }

  it("reads without changing the tower", () => {
    const rust = towerWith("classic", [{ kind: "office", floor: 2, x: 160, state: "occupied", satisfaction: 0.5 }]);
    const save = rust.serialize();
    const reader = new RoomTierReader(rust);
    expect(reader.read().size).toBe(1);
    expect(reader.read().size).toBe(1);
    expect(rust.serialize()).toBe(save);
  });
});
