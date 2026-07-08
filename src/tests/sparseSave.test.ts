import { describe, it, expect } from "vitest";
import { inflateSync } from "fflate";
// The real 12,975-unit v1 tower (vite ?raw), the same fixture the reflow tests pin.
import towerFile from "./fixtures/towerone_6.vctower?raw";
import { Simulation, serializeUnit } from "../engine/Simulation";
import { FACILITIES } from "../engine/facilities";
import type { SerializedGame, SerializedUnit, Unit } from "../engine/types";

/**
 * Sparse v3 unit serialization: `serializeUnit` omits every field whose value
 * equals the fallback `Simulation.deserialize` restores. These tests pin the two
 * tables against each other (the drift guard the party demanded) and pin the
 * width carve-out: rooms always persist width, only width-1 floor/lobby tiles
 * omit it.
 */

/** Decode the `.vctower` container synchronously (no DecompressionStream). */
function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

/** Re-materialize the pre-v3 full unit shape from a sparse unit, applying the
 *  exact fallbacks deserialize uses. Lets the tests compare "sparse save" and
 *  "equivalent full-shape save" through the loader. */
function materialize(u: SerializedUnit): Unit {
  return {
    width: FACILITIES[u.kind].width,
    state: "empty",
    satisfaction: 1,
    occupants: 0,
    everOccupied: false,
    pendingIncome: 0,
    label: FACILITIES[u.kind].name,
    ...u,
  } as Unit;
}

/** A sim exercising every omit branch: defaults, tenant labels, sold condo,
 *  vacating office, cinema policy, construction. */
function sampleSim(): Simulation {
  // Modern mode so the sold condo's `residents` survives the load (Classic
  // strips it by design and would hide a round-trip asymmetry here).
  const sim = Simulation.newGame(7, "modern");
  sim.money = 1e9;
  const place = (kind: Parameters<Simulation["tower"]["place"]>[0], floor: number, x: number) => {
    const res = sim.tower.place(kind, floor, x);
    if (!res.ok) throw new Error(`place ${kind} failed: ${res.reason}`);
    // Look the unit up by identity, never by insertion order, so the helper
    // stays correct if place() ever pads or sorts the unit list.
    const placed = sim.tower.units.find((u) => u.kind === kind && u.floor === floor && u.x === x);
    if (!placed) throw new Error(`placed ${kind} not found at ${floor}:${x}`);
    return placed;
  };
  for (let i = 0; i < 16; i++) place("lobby", 1, 207 + i); // widen the seeded ground strip
  for (let i = 0; i < 56; i++) place("floor", 2, 167 + i);
  const office = place("office", 2, 168);
  office.state = "occupied";
  office.label = "Acme Corp";
  office.satisfaction = 0.62;
  office.occupants = 6;
  office.everOccupied = true;
  office.pendingIncome = 1234;
  office.rent = 9000;
  office.vacateReason = "rent";
  office.vacateAt = 4321;
  const condo = place("condo", 2, 177);
  condo.state = "occupied";
  condo.everOccupied = true;
  condo.rent = 150_000;
  condo.residents = 4;
  const site = place("fastFood", 2, 194);
  site.state = "construction";
  site.completeAt = 999;
  return sim;
}

describe("sparse v3 unit serialization", () => {
  it("omits every loader-default field from a plain floor tile (and its width-1)", () => {
    const sim = sampleSim();
    const tile = sim.serialize().units.find((u) => u.kind === "floor")!;
    expect(Object.keys(tile).sort()).toEqual(["floor", "id", "kind", "x"]);
  });

  it("pins floor and lobby catalog width to 1 (sparse saves omit width relying on it)", () => {
    // serializeUnit omits width for width-1 floor/lobby tiles and deserialize
    // restores it from the catalog. Changing either catalog width would re-lay
    // every existing sparse save, so the edit must fail here first and ship
    // with its own migration.
    expect(FACILITIES.floor.width).toBe(1);
    expect(FACILITIES.lobby.width).toBe(1);
  });

  it("keeps width on rooms even at catalog width (widths are tuning that drifts)", () => {
    const sim = sampleSim();
    const office = sim.serialize().units.find((u) => u.kind === "office")!;
    expect(office.width).toBe(FACILITIES.office.width);
  });

  it("keeps every non-default field", () => {
    const sim = sampleSim();
    const units = sim.serialize().units;
    const office = units.find((u) => u.kind === "office")!;
    expect(office).toMatchObject({
      state: "occupied",
      label: "Acme Corp",
      satisfaction: 0.62,
      occupants: 6,
      everOccupied: true,
      pendingIncome: 1234,
      rent: 9000,
      vacateReason: "rent",
      vacateAt: 4321,
    });
    expect(units.find((u) => u.kind === "condo")).toMatchObject({ everOccupied: true, rent: 150_000, residents: 4 });
    expect(units.find((u) => u.kind === "fastFood")).toMatchObject({ state: "construction", completeAt: 999 });
  });

  it("loads a sparse save to the same state as the equivalent full-shape save (drift guard)", () => {
    const sparse = sampleSim().serialize();
    const full: SerializedGame = { ...sparse, units: sparse.units.map(materialize) };
    const fromSparse = Simulation.deserialize(JSON.parse(JSON.stringify(sparse)) as SerializedGame);
    const fromFull = Simulation.deserialize(JSON.parse(JSON.stringify(full)) as SerializedGame);
    expect(fromSparse.serialize()).toEqual(fromFull.serialize());
    expect(fromSparse.tower.units.map((u) => ({ ...u }))).toEqual(fromFull.tower.units.map((u) => ({ ...u })));
  });

  it("round-trips: serialize -> deserialize -> serialize is stable", () => {
    const first = sampleSim().serialize();
    const second = Simulation.deserialize(JSON.parse(JSON.stringify(first)) as SerializedGame).serialize();
    expect(second).toEqual(first);
  });

  it("serializeUnit mirrors the deserialize fallbacks for an all-default unit", () => {
    const u: Unit = {
      id: 42,
      kind: "office",
      floor: 3,
      x: 10,
      width: FACILITIES.office.width,
      state: "empty",
      satisfaction: 1,
      occupants: 0,
      everOccupied: false,
      pendingIncome: 0,
      label: FACILITIES.office.name,
    };
    // width survives (room carve-out); every behavioral default is dropped.
    expect(serializeUnit(u)).toEqual({ id: 42, kind: "office", floor: 3, x: 10, width: FACILITIES.office.width });
    expect(materialize(serializeUnit(u))).toEqual(u);
  });

  it("shrinks the REAL 12,975-unit tower to under half its full-shape JSON and reloads identically", () => {
    const sim = Simulation.deserialize(decodeVctower(towerFile)); // v1 fixture -> reflow -> live tower
    const sparse = sim.serialize();
    expect(sparse.version).toBe(3);
    const sparseJson = JSON.stringify(sparse);
    const fullJson = JSON.stringify({ ...sparse, units: sparse.units.map(materialize) });
    expect(sparseJson.length).toBeLessThan(fullJson.length * 0.5);
    const reloaded = Simulation.deserialize(JSON.parse(sparseJson) as SerializedGame);
    expect(reloaded.serialize()).toEqual(sparse);
    expect(reloaded.population).toBe(sim.population);
    expect(reloaded.money).toBe(sim.money);
    expect(reloaded.tower.functionalParkingSpots()).toBe(sim.tower.functionalParkingSpots());
  });
});
