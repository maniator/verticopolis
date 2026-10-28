import { deflateSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { MAX_SAVE_INFLATED_BYTES, TOWER_FILE_MAGIC, toBase64 } from "../../storage/saveCompression";
import { Simulation } from "../Simulation";
import { INVALID_REQUEST, UNKNOWN_FACILITY } from "../request";
import { KIND_CODES, UNIT_STATE_CODES, VIEW_LAYOUT, VIEW_LAYOUT_TEXT, codeOf } from "./layout";
import { roomUnits, setRoomState, watchRooms } from "../tower/rooms";
import { MetaLog } from "./metaLog";
import { ONBOARDING_FLAG } from "./queries";
import { TsEngine } from "./tsEngine";
import type { SerializedGame } from "../types";

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
    expect(e.onboarding() & ONBOARDING_FLAG.lobby).toBe(ONBOARDING_FLAG.lobby);
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

  it("keeps congestion until a step, an edit or a room's change", () => {
    const e = engine();
    const walk = vi.spyOn(e.sim, "congestion");
    const office = e.sim.tower.units.find((u) => u.kind === "office")!;
    const first = e.congestion();
    expect(e.congestion()).toBe(first);
    expect(walk).toHaveBeenCalledTimes(1);
    // A room's change, an edit and a step each move the key once.
    setRoomState(e.sim.tower, office, office.state === "occupied" ? "empty" : "occupied");
    e.congestion();
    e.sim.build("office", 3, 200);
    e.congestion();
    e.tick(2);
    e.congestion();
    e.congestion();
    expect(walk).toHaveBeenCalledTimes(4);
    expect(e.congestion()).toBe(e.sim.congestion());
  });

  it("steps a frame's time and keeps the step mode across a swap", () => {
    const e = engine();
    const before = e.sim.clock.minutes;
    const [steps, owed] = Array.from(e.advance(0, 1000, 120, true, true));
    expect(steps).toBeGreaterThan(0);
    expect(owed).toBeGreaterThanOrEqual(0);
    expect(e.sim.clock.minutes).toBeGreaterThan(before);
    expect(Array.from(e.advance(5, 16, 120, true, false))[0]).toBe(0);
    e.loadSave(e.serialize());
    // The same rate and pacing: nothing owed is dropped.
    expect(Array.from(e.advance(1.5, 0, 120, true, false))).toEqual([0, 1.5]);
    // A new rate drops the carry.
    expect(Array.from(e.advance(1.5, 0, 30, true, false))).toEqual([0, 0]);
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

describe("TsEngine.take", () => {
  it("starts its own state again on a tower the app swapped in, and leaves the events to the app", () => {
    const e = TsEngine.newGame(5, "modern");
    e.tick(60);
    e.viewFrame(true);
    const gen = e.generation();
    e.take(e.sim);
    expect(e.generation(), "the same tower is no swap").toBe(gen);
    const old = e.sim;
    old.gameplayEvents.drain();
    old.build("lobby", 1, 160);
    const left = old.gameplayEvents.length;
    const next = Simulation.newGame(9, "classic");
    const own = next.gameplayEvents.length;
    e.take(next);
    expect([e.sim, e.generation()]).toEqual([next, gen + 1]);
    expect(e.viewFrame(true)[JSON.parse(e.viewLayout()).header.frameSeq]).toBe(1);
    expect([next.gameplayEvents.length, old.gameplayEvents.length], "the app hands the events on, not the engine").toEqual([own, left]);
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

describe("TsEngine's reports and files", () => {
  const slot = (record: string, name: string): number =>
    (VIEW_LAYOUT.records as Record<string, string[]>)[record].indexOf(name);

  it("answers the stats sheet and a room's facts", () => {
    const e = engine();
    e.tick(120);
    expect(e.statsSheet().length).toBeGreaterThanOrEqual(VIEW_LAYOUT.records.statsSheet.length);
    const office = idOf(e, "office");
    const facts = e.unitFacts(office);
    expect(facts).toHaveLength(VIEW_LAYOUT.records.unitFacts.length);
    expect(facts[slot("unitFacts", "id")]).toBe(office);
    for (const id of [0, 1.5, NaN, -1]) expect(e.unitFacts(id)).toHaveLength(0);
    // Every room after a few days, so the gripe and lease sections fill.
    for (let day = 0; day < 3; day++) e.tick(1440);
    expect(e.statsSheet().length).toBeGreaterThanOrEqual(VIEW_LAYOUT.records.statsSheet.length);
    for (const u of e.sim.tower.units) expect(e.unitFacts(u.id)).toHaveLength(VIEW_LAYOUT.records.unitFacts.length);
  });

  it("writes and reads .vctower files, with the founder rule", () => {
    const e = engine();
    const founder = (): boolean | undefined => (JSON.parse(e.serialize()) as { founder?: boolean }).founder;
    expect(e.exportVctower("1.9.0", 1_700_000_000_000)).toBeUndefined();
    expect(e.lastReason()).toContain("before 2.0");
    expect(e.exportVctower("3.1.0", NaN)).toBeUndefined();
    expect(e.lastReason()).toContain("is not a time");
    const text = e.exportVctower("3.1.0", 1_700_000_000_000)!;
    expect(Array.from(e.loadVctower(text))).toEqual([1, 1]);
    expect(founder()).not.toBe(true);
    // The payload is read the way `Buffer.from(b64, "base64")` reads it.
    const [magic, body] = text.trim().split("\n");
    expect(e.loadVctower(`${magic}\n${body.slice(0, 40)}!${body.slice(40)}\n`)[0]).toBe(1);
    expect(e.loadVctower(`${magic}\n${body.replace(/\+/g, "-").replace(/\//g, "_")}\n`)[0]).toBe(1);
    expect(e.loadVctower(`${magic}\n${body.replace(/=+$/, "")}\n`)[0]).toBe(1);
    const bomb = `${TOWER_FILE_MAGIC}\n${toBase64(deflateSync(new Uint8Array(MAX_SAVE_INFLATED_BYTES + 1)))}\n`;
    expect(e.loadVctower(bomb)[0]).toBe(0);
    expect(e.lastReason()).toContain("looks crafted");
    expect(Array.from(e.loadVctower("not a tower"))).toEqual([0, 4]);
    expect(e.lastReason()).toBeTruthy();
    // A stored save with no appVersion is a founder's tower; a restore is not.
    const save = JSON.parse(e.serialize()) as Record<string, unknown>;
    delete save.appVersion;
    e.restore(JSON.stringify(save));
    expect(founder()).not.toBe(true);
    e.loadSave(JSON.stringify(save));
    expect(founder()).toBe(true);
    expect(e.loadSave("null")[0]).toBe(0);
    expect(e.lastReason()).toBe("not a tower save (the save is null)");
  });

  it("writes, stages and adopts .TDT files", () => {
    expect(engine().tdtExport()[0]).toBe(0);
    const sim = Simulation.newGame(3, "classic");
    sim.money = 1e8;
    for (let x = 160; x < 280; x++) sim.build("lobby", 1, x);
    for (let x = 160; x < 280; x++) sim.build("floor", 2, x);
    sim.build("office", 2, 170);
    const e = new TsEngine(sim);
    expect(e.adoptTdt()[0]).toBe(0);
    expect(e.lastReason()).toBe(INVALID_REQUEST);
    expect(e.tdtFile()).toBeUndefined();
    const out = e.tdtExport();
    expect(out[0], String(e.lastReason())).toBe(1);
    expect(out).toHaveLength(VIEW_LAYOUT.records.tdtExport.length);
    const bytes = e.tdtFile()!;
    expect(bytes.length).toBeGreaterThan(0);
    expect(e.tdtFile()).toBeUndefined();
    const staged = e.loadTdt(bytes, "SPIRE.TDT");
    expect(staged[0], String(e.lastReason())).toBe(1);
    expect(staged).toHaveLength(VIEW_LAYOUT.records.loadTdt.length);
    expect(e.tdtTowerName()).toBeDefined();
    expect(e.tdtNote(1.5)).toBeUndefined();
    const notes = staged[slot("loadTdt", "notes")] + staged[slot("loadTdt", "warnings")];
    for (let i = 0; i < notes; i++) expect(e.tdtNote(i)).toBeTruthy();
    expect(e.adoptTdt()[0]).toBe(1);
    expect(e.tdtTowerName()).toBeUndefined();
    // A done swap drops a staged file and an unclaimed export.
    e.loadTdt(bytes, "SPIRE.TDT");
    e.tdtExport();
    e.loadSave(e.serialize());
    expect(e.adoptTdt()[0]).toBe(0);
    expect(e.tdtFile()).toBeUndefined();
    // So does a tower the game swapped in itself.
    e.loadTdt(bytes, "SPIRE.TDT");
    e.tdtExport();
    e.take(Simulation.deserialize(JSON.parse(e.serialize()) as SerializedGame));
    expect(e.tdtTowerName()).toBeUndefined();
    expect(e.tdtFile()).toBeUndefined();
    expect(Array.from(e.loadTdt(Uint8Array.of(1, 2, 3), "BAD.TDT"))).toEqual([0]);
    expect(e.lastReason()).toContain("SimTower");
  });
});
