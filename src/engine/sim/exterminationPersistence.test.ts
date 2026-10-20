import { describe, expect, it } from "vitest";
import { Simulation } from "../Simulation";
import type { SerializedGame } from "../types";
import { coerceExterminationRoomIds } from "./coerce";
import { resolveExtermination } from "./services";
import { UNIT_CAP } from "./deserializeGuards";

/** A Modern tower's save with one infested room booked for the exterminator
 *  and a second room infested after the booking, written into the save the
 *  way an overnight escalation leaves it. On the WASM parity projects the
 *  booking runs on the engine too and `serialize` returns the engine's save,
 *  so nothing here edits the instance after the booking. */
function booked(): { raw: SerializedGame; paid: number; later: number } {
  const sim = Simulation.newGame(902, "modern");
  sim.money = 1e8;
  for (let x = 170; x < 220; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 220; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const a = sim.tower.place("hotelSingle", 2, 170);
  const b = sim.tower.place("hotelSingle", 2, 190);
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  const paid = a.unitId!;
  const later = b.unitId!;
  sim.tower.getUnit(paid)!.state = "infested";
  expect(sim.callExterminator()).toMatchObject({ ok: true, rooms: 1 });
  const raw = JSON.parse(JSON.stringify(sim.serialize())) as SerializedGame;
  raw.units.find((u) => u.id === later)!.state = "infested";
  return { raw, paid, later };
}

/** Load a copy of `raw` and land its treatment on the TypeScript engine. */
function treated(raw: SerializedGame): Simulation {
  const sim = Simulation.deserialize(structuredClone(raw));
  sim.clock.minutes += 1440;
  resolveExtermination(sim);
  return sim;
}

describe("pending exterminator persistence", () => {
  it("treats only billed rooms after reload, clears the booking and allows a relapse booking", () => {
    const { raw, paid, later } = booked();
    expect(raw.exterminationRoomIds).toEqual([paid]);
    expect(Simulation.deserialize(structuredClone(raw)).callExterminator()).toMatchObject({ ok: false, reason: "pending" });
    const restored = treated(raw);
    expect(restored.tower.getUnit(paid)!.state).toBe("empty");
    expect(restored.tower.getUnit(later)!.state).toBe("infested");
    expect(restored.exterminationRoomIds).toBeUndefined();
    expect(restored.serialize()).not.toHaveProperty("exterminationRoomIds");
    restored.tower.getUnit(paid)!.state = "infested";
    expect(restored.callExterminator()).toMatchObject({ ok: true, rooms: 2 });
  });

  it("keeps the legacy tower-wide treatment only when the list is absent", () => {
    const { raw, paid, later } = booked();
    delete raw.exterminationRoomIds;
    expect(Simulation.deserialize(structuredClone(raw)).exterminationRoomIds).toBeUndefined();
    const restored = treated(raw);
    expect([paid, later].map((id) => restored.tower.getUnit(id)!.state)).toEqual(["empty", "empty"]);
  });

  it("bills no rooms for a list that is not an array", () => {
    const { raw, paid } = booked();
    for (const bad of ["bad", null, { 0: 1 }]) {
      (raw as unknown as Record<string, unknown>).exterminationRoomIds = bad;
      expect(Simulation.deserialize(structuredClone(raw)).exterminationRoomIds).toEqual([]);
      const restored = treated(raw);
      expect(restored.tower.getUnit(paid)!.state).toBe("infested");
      expect(restored.exterminationDueDay).toBeUndefined();
    }
  });

  it("ignores a list without a due day or in Classic", () => {
    const { raw, paid } = booked();
    delete raw.exterminationDueDay;
    expect(raw.exterminationRoomIds).toEqual([paid]);
    expect(Simulation.deserialize(structuredClone(raw)).exterminationRoomIds).toBeUndefined();
    raw.mode = "classic";
    raw.exterminationDueDay = 1;
    expect(Simulation.deserialize(raw).exterminationRoomIds).toBeUndefined();
  });

  it("skips a billed room demolished before the treatment", () => {
    const { raw, paid, later } = booked();
    const restored = Simulation.deserialize(raw);
    const x = restored.tower.getUnit(paid)!.x;
    expect(restored.tower.removeUnit(paid)).toBeDefined();
    const rebuilt = restored.tower.place("hotelSingle", 2, x).unitId!;
    expect(rebuilt).not.toBe(paid);
    restored.tower.getUnit(rebuilt)!.state = "infested";
    restored.clock.minutes += 1440;
    resolveExtermination(restored);
    expect([rebuilt, later].map((id) => restored.tower.getUnit(id)!.state)).toEqual(["infested", "infested"]);
    expect(restored.exterminationDueDay).toBeUndefined();
    expect(restored.exterminationRoomIds).toBeUndefined();
  });

  it("normalizes raw ids without coercion and bounds unique retained ids", () => {
    expect(coerceExterminationRoomIds([1, 1, 2.5, "2", null, true, -1, 0, NaN, Infinity, 2 ** 31, 3])).toEqual([1, 3]);
    expect(coerceExterminationRoomIds(null)).toEqual([]);
    expect(coerceExterminationRoomIds(undefined)).toBeUndefined();
  });

  it("keeps the first UNIT_CAP valid unique ids", () => {
    // The same list as the Rust test: invalid entries and a repeat just short
    // of the cap count for nothing, and the cap keeps the first.
    const head = [2 ** 31 - 1, 0, -1, 2.5, "2", null, true, 2 ** 31];
    const body = Array.from({ length: UNIT_CAP - 2 }, (_, i) => i + 1);
    const ids = coerceExterminationRoomIds([...head, ...body, 1, UNIT_CAP - 1, UNIT_CAP, UNIT_CAP + 1])!;
    expect(ids).toHaveLength(UNIT_CAP);
    expect(ids).toEqual([2 ** 31 - 1, ...body, UNIT_CAP - 1]);
  });
});
