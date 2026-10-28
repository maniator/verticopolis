import { describe, expect, it } from "vitest";
import { Simulation } from "../Simulation";
import { INVALID_REQUEST, UNKNOWN_FACILITY } from "../request";
import { KIND_CODES, UNIT_STATE_CODES, VIEW_LAYOUT, VIEW_LAYOUT_TEXT, codeOf } from "./layout";
import { roomUnits, watchRooms } from "../tower/rooms";
import { MetaLog } from "./metaLog";
import { TsEngine } from "./tsEngine";

/**
 * `TsEngine` on its own, in the `unit` project: each member's answer shape
 * and the refusals, so the module is covered where no WASM package is
 * built. The golden integration test (`tsEngine.golden.integration.test.ts`)
 * holds every answer to the Rust engine's.
 */

const code = (kind: string): number => codeOf(KIND_CODES, kind);

function engine(): TsEngine {
  const sim = Simulation.newGame(3, "modern");
  sim.money = 1e8;
  sim.star = 3;
  for (let x = 160; x < 280; x++) sim.build("lobby", 1, x);
  for (const floor of [2, 3]) for (let x = 160; x < 280; x++) sim.build("floor", floor, x);
  sim.build("office", 2, 170);
  sim.build("fastFood", 2, 190);
  sim.build("cinema", 2, 220);
  sim.buildTransport("elevatorStandard", 162, 1, 3);
  return new TsEngine(sim);
}

const idOf = (e: TsEngine, kind: string): number => e.sim.tower.units.find((u) => u.kind === kind)!.id;
const lift = (e: TsEngine): number => e.sim.tower.transports[0].id;

describe("TsEngine", () => {
  it("answers each command with its record", () => {
    const e = engine();
    const office = idOf(e, "office");
    const food = idOf(e, "fastFood");
    const cinema = idOf(e, "cinema");
    const id = lift(e);
    const schedule = new Float64Array(VIEW_LAYOUT.scheduleSlots);
    const done = (r: Float64Array) => expect(r[0], String(e.lastReason())).toBe(1);
    done(e.buildAt(code("office"), 2, 255));
    expect(e.paintTiles(code("floor"), 4, Float64Array.of(160, 161))[2]).toBe(2);
    done(e.buildShaft(code("stairs"), 275, 1, 2));
    expect(e.changeCars(id, true)[2]).toBe(2);
    done(e.startExtend(id));
    expect(Array.from(e.extendShaft(id, true, 4).slice(2))).toEqual([1, 4, 1]);
    done(e.stopExtend());
    done(e.markStop(id, 2, false));
    done(e.expressStops(id));
    done(e.dropStops(id));
    done(e.scheduleShaft(id, schedule));
    done(e.labelUnit(office, "Big"));
    expect(e.stepRent(office, 1)[2]).toBeGreaterThan(0);
    expect(e.setRent(office, 5000)[2]).toBe(5000);
    expect(e.rentBatch(code("office"), NaN, false)).toHaveLength(10);
    expect(e.setFilm(cinema, 2)[2]).toBe(2);
    expect(e.rerollUnit(food)[2]).toBeGreaterThanOrEqual(0);
    done(e.chooseAutoBridge(false));
    done(e.flipAutoBridge());
    done(e.nameTower("Spire"));
    expect(e.towerName()).toBe("Spire");
    done(e.nameTower(null));
    expect(e.towerName()).toBeUndefined();
    done(e.setCamera(1.5, 2, NaN));
    expect(e.view()).toBe('{"tile":1.5,"floor":2}');
    done(e.logLine("Hi", 1));
    done(e.demolish(food, true));
    expect(e.bookExterminator()[0]).toBe(0);
    expect(e.answerChoice(true)[0]).toBe(0);
    expect(e.pendingChoice()).toBeUndefined();
  });

  it("refuses malformed arguments before the simulation sees them", () => {
    const e = engine();
    const refused = (r: Float64Array, reason = INVALID_REQUEST) => {
      expect(r[0]).toBe(0);
      expect(e.lastReason()).toBe(reason);
    };
    refused(e.buildAt(99, 2, 1), UNKNOWN_FACILITY);
    refused(e.buildAt(code("office"), 1.5, 1));
    refused(e.paintTiles(-1, 2, Float64Array.of(1)), UNKNOWN_FACILITY);
    refused(e.buildShaft(99, 1, 1, 2), UNKNOWN_FACILITY);
    refused(e.buildShaft(code("stairs"), NaN, 1, 2));
    refused(e.demolish(NaN, false));
    refused(e.changeCars(0.5, true));
    expect(Array.from(e.extendShaft(lift(e), true, NaN).slice(2))).toEqual([1, 3, 0]);
    refused(e.stepRent(1, 2));
    refused(e.setRent(1, -1));
    refused(e.rentBatch(99, 1, false), UNKNOWN_FACILITY);
    refused(e.rentBatch(code("office"), -2, false));
    refused(e.setFilm(1, 3));
    refused(e.rerollUnit(Infinity));
    refused(e.setCamera(Infinity, 1, 1));
    refused(e.logLine("x", 9));
    refused(e.scheduleShaft(lift(e), new Float64Array(3)));
    const bad = new Float64Array(VIEW_LAYOUT.scheduleSlots);
    bad[0] = 2;
    refused(e.scheduleShaft(lift(e), bad));
    expect(e.quoteBuild(99, 1, 1)[0]).toBe(0);
    expect(e.lastReason()).toBe(UNKNOWN_FACILITY);
    expect(e.quoteShaft(code("stairs"), 1.5, 1, 2)[0]).toBe(0);
    expect(e.quoteShaft(99, 1, 1, 2)[0]).toBe(0);
    expect(e.quoteBuild(code("office"), NaN, 1)[0]).toBe(0);
    // A query refuses with its empty answer and leaves the reason alone.
    expect(e.heatCells(7)).toHaveLength(0);
    expect(e.unitCard(1.5)).toHaveLength(0);
    expect(e.shaftCard(-1)).toHaveLength(0);
    expect(e.lastReason()).toBe(INVALID_REQUEST);
  });

  it("answers the queries and the view", () => {
    const e = engine();
    expect(e.viewLayout()).toBe(VIEW_LAYOUT_TEXT);
    expect(e.quoteBuild(code("office"), 3, 200)[0]).toBe(1);
    expect(e.quoteShaft(code("stairs"), 275, 1, 2)[0]).toBe(1);
    expect(e.statsStrip()).toHaveLength(VIEW_LAYOUT.records.statsStrip.length);
    expect(e.hotspot()).toHaveLength(2);
    expect(e.onboarding() & 1).toBe(1);
    for (let m = 0; m < 4; m++) expect(e.heatCells(m).length % 5).toBe(0);
    expect(e.crewCoverage()).toHaveLength(7);
    expect(e.unitCard(idOf(e, "cinema"))).toHaveLength(20);
    expect(e.shaftCard(lift(e)).length).toBeGreaterThan(12);
    expect(e.viewStructure().length).toBeGreaterThan(VIEW_LAYOUT.structureWidth);
    const first = e.viewFrame(false);
    expect(first[VIEW_LAYOUT.header.full]).toBe(1);
    e.tick(60);
    expect(e.viewFrame(false)[VIEW_LAYOUT.header.full]).toBe(0);
    expect(e.unitLabel(idOf(e, "office"))).toBe("Office");
    expect(e.unitSubtype(idOf(e, "fastFood"))).toBeDefined();
    expect(e.unitLabel(1.5)).toBeUndefined();
    expect(e.logAfter(0).length % 3).toBe(0);
    expect(e.logAfter(NaN)).toHaveLength(0);
    expect(e.logText(NaN)).toBeUndefined();
    expect(e.eventText(0)).toBeUndefined();
    expect(e.undoSignature()).toContain("office");
  });

  it("swaps towers, keeping the generation and the events' rules", () => {
    const e = engine();
    const save = e.serialize();
    e.setCamera(10, 2, 2);
    expect(Array.from(e.restore(save))).toEqual([1, 1]);
    expect(e.view()).toBe('{"tile":10,"floor":2,"zoom":2}');
    expect(Array.from(e.loadSave(save))).toEqual([1, 2]);
    expect(Array.from(e.loadSave("{"))).toEqual([0, 2]);
    expect(e.lastReason()).toBeTruthy();
    expect(Array.from(e.foundTower(-1, 0, 0, false))).toEqual([0, 2]);
    expect(Array.from(e.foundTower(4, 1, 1, true))).toEqual([1, 3]);
    // A replaced tower's undrained events go ahead of the new one's, unless
    // it was the backdrop.
    const owed = (backdrop: boolean): number => {
      e.drainEvents();
      e.setBackdrop(backdrop);
      e.buildAt(code("lobby"), 1, 100);
      e.foundTower(4, 0, 0, false);
      return e.drainEvents()[1];
    };
    expect(owed(false)).toBe(owed(true) + 1);
    expect(TsEngine.newGame(1).generation()).toBe(0);
  });
});

describe("MetaLog", () => {
  it("lists edits after a revision, and everything when it cannot", () => {
    const e = engine();
    const tower = e.sim.tower;
    const office = idOf(e, "office");
    const log = new MetaLog();
    const marked = watchRooms(tower);
    const pass = () => {
      log.sync(tower, marked);
      marked.clear();
    };
    log.sync(tower);
    expect(Array.from(log.changed(tower, 0)).slice(1, 2)).toEqual([1]);
    tower.setLabel(office, "Renamed");
    pass();
    expect(Array.from(log.changed(tower, 1))).toEqual([2, 0, office]);
    // A room built after the first sync logs nothing.
    e.buildAt(code("office"), 3, 200);
    pass();
    expect(log.revision).toBe(2);
    // A mark with no change logs nothing.
    marked.add(tower.getUnit(office)!);
    pass();
    expect(log.revision).toBe(2);
    // Past the cap the older half goes, and a reader that far back gets a
    // full listing.
    for (let i = 0; i < 4100; i++) {
      tower.setLabel(office, `n${i}`);
      pass();
    }
    expect(log.changed(tower, 2)[1]).toBe(1);
    expect(log.changed(tower, log.revision - 1)[1]).toBe(0);
    log.sync(Simulation.newGame(1, "classic").tower);
    expect(log.revision).toBe(1);
  });
});

describe("TsEngine's frames and meta log from the room marks", () => {
  it("send every change a walk over every room would find (#1389)", () => {
    const e = engine();
    // Homes and a hotel room send people out for meals (outForMeal).
    for (const [kind, x] of [["condo", 196], ["condo", 260], ["hotelSingle", 170], ["hotelSingle", 180]] as const) expect(e.buildAt(code(kind), 3, x)[0], `${kind} at ${x}: ${e.lastReason()}`).toBe(1);
    const L = VIEW_LAYOUT;
    const h = L.header;
    const fields = (slot: number): number[] => {
      const u = roomUnits(e.sim.tower)[slot];
      return [codeOf(UNIT_STATE_CODES, u.state), u.occupants, u.customersIn ?? -1, u.hotelCustomersIn ?? -1, u.outForMeal ?? -1];
    };
    // What a reader holds: each slot's fields as sent, and each id's text as
    // the meta log last named it.
    let held: number[][] = [];
    const text = new Map<number, string>();
    const said = (u: { label: string; subtype?: string }) => `${u.label}|${u.subtype ?? ""}`;
    let since = 0;
    let rooms = -1;
    let partial = 0;
    for (let i = 0; i < 400; i++) {
      if (i === 150) expect(e.labelUnit(idOf(e, "office"), "Midway")[0]).toBe(1);
      if (i === 250) e.buildAt(code("office"), 3, 230);
      e.tick(30);
      const f = e.viewFrame(false);
      if (f[h.full] === 1) held = [];
      else partial++;
      const rows = L.headerWidth + f[h.people] * L.personWidth;
      for (let k = 0; k < f[h.units]; k++) {
        const at = rows + k * L.unitWidth;
        held[f[at]] = Array.from(f.subarray(at + 1, at + L.unitWidth));
      }
      expect(held.length).toBe(f[h.rooms]);
      for (let slot = 0; slot < f[h.rooms]; slot++) expect(held[slot], `slot ${slot} at frame ${i}`).toEqual(fields(slot));
      const meta = e.unitMetaChanged(since);
      const units = e.sim.tower.units;
      // A new room's text is read directly, as the shared reader does.
      if (meta[1] === 1 || units.length !== rooms) for (const u of units) text.set(u.id, said(u));
      for (const id of meta.subarray(2)) text.set(id, said(e.sim.tower.getUnit(id)!));
      for (const u of units) expect(text.get(u.id), `unit ${u.id} at frame ${i}`).toBe(said(u));
      since = meta[0];
      rooms = units.length;
    }
    expect(partial).toBeGreaterThan(300);
    expect(since).toBeGreaterThan(1);
  });
});
