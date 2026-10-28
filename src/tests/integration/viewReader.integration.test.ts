import { afterEach, describe, expect, it } from "vitest";
import { facilityFloors } from "../../engine/facilities";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { KIND_CODES, codeOf } from "../../engine/port/layout";
import { TsEngine } from "../../engine/port/tsEngine";
import { roomUnits, structureRuns } from "../../engine/tower/rooms";
import type { EnginePort } from "../../simport/enginePort";
import type { SimView } from "../../simport/view";
import { ViewReader } from "../../simport/viewReader";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The shared reader (contract section 5) on both engines: a `ViewReader`
 * over the Rust `Engine` and one over `TsEngine` decode the same `SimView`,
 * and both match the TypeScript `Simulation` they mirror, field for field,
 * through play, builds, label and subtype changes, an emergency and a swap.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type RustEngine = EnginePort & { free(): void };
const freed: RustEngine[] = [];
afterEach(() => {
  for (const e of freed.splice(0)) e.free();
});

function pair(): { rust: EnginePort; ts: TsEngine } {
  const built = Simulation.newGame(5, "modern");
  built.money = 1e8;
  built.star = 3;
  for (let x = 160; x < 280; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 160; x < 280; x++) expect(built.build("floor", floor, x).ok).toBe(true);
  for (const x of [170, 180]) expect(built.build("office", 2, x).ok).toBe(true);
  for (const floor of [2, 3]) expect(built.build("fastFood", floor, 190).ok).toBe(true);
  expect(built.build("hotelSingle", 3, 170).ok).toBe(true);
  expect(built.build("cinema", 2, 220).ok).toBe(true);
  expect(built.buildTransport("elevatorStandard", 162, 1, 3).ok).toBe(true);
  expect(built.buildTransport("stairs", 275, 1, 2).ok).toBe(true);
  built.tower.unitAt(2, 170)!.label = "Corner Office";
  const save = JSON.stringify(built.serialize());
  const rust = wasm().Engine.fromSave(save) as unknown as RustEngine;
  freed.push(rust);
  return { rust, ts: new TsEngine(Simulation.deserialize(JSON.parse(save) as SerializedGame)) };
}

/** What a painter or the HUD reads, as plain data. */
function snapshot(v: SimView) {
  const h = v.header;
  return {
    header: { ...h, fx: JSON.parse(JSON.stringify(h.fx)) as unknown, camera: h.camera && { ...h.camera } },
    rooms: v.rooms.map((u) => ({ ...u })),
    structure: v.structure.map((r) => ({ kind: r.kind, floor: r.floor, x: r.x, width: r.width, count: r.count })),
    transports: v.tower.transports.map((t) => ({ ...t, carPositions: [...t.carPositions], carLoad: [...(t.carLoad ?? [])], carDir: [...t.carDir] })),
    people: v.crowd.people.map((p) => ({ ...p })),
    bounds: [v.tower.highestFloor, v.tower.lowestFloor, v.tower.revision, v.tower.towerName],
    lookups: [170, 175, 190, 200, 230, 260, 290].flatMap((x) =>
      [1, 2, 3, 4].map((fl) => [v.tower.unitAt(fl, x)?.kind, v.tower.hasStructure(fl, x), v.tower.structureKindAt(fl, x)]),
    ),
  };
}

/** The TypeScript simulation's own answers for the fields the view carries. */
function truth(sim: Simulation) {
  return {
    rooms: roomUnits(sim.tower).map((u) => ({
      id: u.id,
      kind: u.kind,
      floor: u.floor,
      x: u.x,
      width: u.width,
      state: u.state,
      label: u.label,
      subtype: u.subtype,
      occupants: u.occupants,
      customersIn: u.customersIn,
      hotelCustomersIn: u.hotelCustomersIn,
      outForMeal: u.outForMeal,
    })),
    structure: structureRuns(sim.tower).map((r) => ({ kind: r.kind, floor: r.floor, x: r.x, width: r.width, count: r.count })),
    money: sim.money,
    population: sim.population,
    people: sim.crowd.people.length,
  };
}

const plain = (rooms: object[]) => rooms.map((r) => JSON.parse(JSON.stringify(r)) as unknown);

function check(rust: ViewReader, ts: ViewReader, sim: Simulation): void {
  rust.update();
  ts.update();
  const a = snapshot(rust);
  const b = snapshot(ts);
  expect(b).toEqual(a);
  const t = truth(sim);
  expect(plain(b.rooms)).toEqual(plain(t.rooms));
  expect(b.structure).toEqual(t.structure);
  expect([b.header.money, b.header.population, b.people.length]).toEqual([t.money, t.population, t.people]);
}

describe("ViewReader on both engines", () => {
  it.skipIf(!hasWasmPackage())("decodes the same view, and the view the simulation holds", () => {
    const { rust, ts } = pair();
    const r = new ViewReader(rust, facilityFloors);
    const t = new ViewReader(ts, facilityFloors);
    check(r, t, ts.sim);
    const kept = r.rooms;
    for (let i = 0; i < 8; i++) {
      for (const e of [rust, ts]) e.tick(45);
      check(r, t, ts.sim);
    }
    expect(r.rooms, "no rebuild without a revision move").toBe(kept);
    const office = r.rooms.find((u) => u.kind === "office")!.id;
    const food = r.rooms.find((u) => u.kind === "fastFood")!.id;
    for (const e of [rust, ts]) {
      e.labelUnit(office, "Big Office");
      e.rerollUnit(food);
      e.buildAt(codeOf(KIND_CODES, "office"), 2, 255);
      e.paintTiles(codeOf(KIND_CODES, "floor"), 4, Float64Array.of(160, 161, 162));
      e.setCamera(200, 2, 1.5);
    }
    check(r, t, ts.sim);
    expect(r.rooms).not.toBe(kept);
    expect(r.tower.getUnit(office)).toBe(kept.find((u) => u.id === office));
    expect(r.tower.getUnit(office)?.label).toBe("Big Office");
    for (const e of [rust, ts]) e.restore(ts.serialize());
    check(r, t, ts.sim);
    for (const e of [rust, ts]) e.tick(600);
    check(r, t, ts.sim);
  });

  it.skipIf(!hasWasmPackage())("takes a full frame after another caller took one", () => {
    const { rust, ts } = pair();
    const r = new ViewReader(rust, facilityFloors);
    const t = new ViewReader(ts, facilityFloors);
    for (let i = 0; i < 6; i++) {
      for (const e of [rust, ts]) {
        e.tick(45);
        // This frame carries the rooms that changed, and the readers never see it.
        e.viewFrame(false);
      }
      check(r, t, ts.sim);
    }
  });

  it.skipIf(!hasWasmPackage())("keeps a person's object by id, for one generation", () => {
    const { rust, ts } = pair();
    const r = new ViewReader(rust, facilityFloors);
    const t = new ViewReader(ts, facilityFloors);
    for (const e of [rust, ts]) e.tick(480);
    check(r, t, ts.sim);
    const held = new Map(r.crowd.people.map((p) => [p.id, p]));
    let stayed = 0;
    let left = held.size;
    for (let i = 0; i < 4; i++) {
      for (const e of [rust, ts]) e.tick(30);
      check(r, t, ts.sim);
    }
    for (const p of r.crowd.people) {
      const was = held.get(p.id);
      if (was === undefined) continue;
      expect(p).toBe(was);
      stayed++;
      left--;
    }
    expect([stayed > 0, left > 0], "some stayed and some left").toEqual([true, true]);
    for (const e of [rust, ts]) e.restore(ts.serialize());
    check(r, t, ts.sim);
    for (const p of r.crowd.people) expect(p, "a swap starts the pool again").not.toBe(held.get(p.id));
  });
});
