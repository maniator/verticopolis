import { describe, expect, it } from "vitest";
import { Simulation } from "../Simulation";
import type { SerializedGame } from "../types";
import { coerceExterminationRoomIds } from "./coerce";
import { resolveExtermination } from "./services";
import { UNIT_CAP } from "./deserializeGuards";

function booked(): { sim: Simulation; paid: number; later: number } {
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
  sim.tower.getUnit(later)!.state = "infested";
  return { sim, paid, later };
}

describe("pending exterminator persistence", () => {
  it("treats only billed rooms after reload, clears the booking and allows a relapse booking", () => {
    const { sim, paid, later } = booked();
    const raw = JSON.parse(JSON.stringify(sim.serialize())) as SerializedGame;
    expect(raw.exterminationRoomIds).toEqual([paid]);
    const restored = Simulation.deserialize(raw);
    expect(restored.callExterminator()).toMatchObject({ ok: false, reason: "pending" });
    restored.clock.minutes += 1440;
    resolveExtermination(restored);
    expect(restored.tower.getUnit(paid)!.state).toBe("empty");
    expect(restored.tower.getUnit(later)!.state).toBe("infested");
    expect(restored.exterminationRoomIds).toBeUndefined();
    expect(restored.serialize()).not.toHaveProperty("exterminationRoomIds");
    restored.tower.getUnit(paid)!.state = "infested";
    expect(restored.callExterminator()).toMatchObject({ ok: true, rooms: 2 });
  });

  it("keeps the legacy tower-wide treatment only when the list is absent", () => {
    const { sim, paid, later } = booked();
    const raw = sim.serialize();
    delete raw.exterminationRoomIds;
    const restored = Simulation.deserialize(raw);
    expect(restored.exterminationRoomIds).toBeUndefined();
    restored.clock.minutes += 1440;
    resolveExtermination(restored);
    expect([paid, later].map((id) => restored.tower.getUnit(id)!.state)).toEqual(["empty", "empty"]);
  });

  it("bills no rooms for a list that is not an array", () => {
    for (const bad of ["bad", null, { 0: 1 }]) {
      const { sim, paid } = booked();
      const raw = sim.serialize() as unknown as Record<string, unknown>;
      raw.exterminationRoomIds = bad;
      const restored = Simulation.deserialize(raw as unknown as SerializedGame);
      expect(restored.exterminationRoomIds).toEqual([]);
      restored.clock.minutes += 1440;
      resolveExtermination(restored);
      expect(restored.tower.getUnit(paid)!.state).toBe("infested");
      expect(restored.exterminationDueDay).toBeUndefined();
    }
  });

  it("ignores a list without a due day or in Classic", () => {
    const { sim, paid } = booked();
    const raw = sim.serialize();
    delete raw.exterminationDueDay;
    expect(raw.exterminationRoomIds).toEqual([paid]);
    expect(Simulation.deserialize(raw).exterminationRoomIds).toBeUndefined();
    raw.mode = "classic";
    raw.exterminationDueDay = 1;
    expect(Simulation.deserialize(raw).exterminationRoomIds).toBeUndefined();
  });

  it("skips a billed room demolished before the treatment", () => {
    const { sim, paid, later } = booked();
    const restored = Simulation.deserialize(sim.serialize());
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
