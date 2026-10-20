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

  it("ignores orphan and Classic lists and does not turn malformed lists into free treatment", () => {
    const { sim, paid } = booked();
    const raw = sim.serialize();
    (raw as unknown as Record<string, unknown>).exterminationRoomIds = "bad";
    const restored = Simulation.deserialize(raw);
    expect(restored.exterminationRoomIds).toEqual([]);
    restored.clock.minutes += 1440;
    resolveExtermination(restored);
    expect(restored.tower.getUnit(paid)!.state).toBe("infested");
    delete raw.exterminationDueDay;
    expect(Simulation.deserialize(raw).exterminationRoomIds).toBeUndefined();
    raw.mode = "classic";
    raw.exterminationDueDay = 1;
    expect(Simulation.deserialize(raw).exterminationRoomIds).toBeUndefined();
  });

  it("normalizes raw ids without coercion and bounds unique retained ids", () => {
    expect(coerceExterminationRoomIds([1, 1, 2.5, "2", null, true, -1, 0, NaN, Infinity, 2 ** 31, 3])).toEqual([1, 3]);
    expect(coerceExterminationRoomIds(null)).toEqual([]);
    expect(coerceExterminationRoomIds(undefined)).toBeUndefined();
    expect(coerceExterminationRoomIds(Array.from({ length: UNIT_CAP + 5 }, (_, i) => i + 1))).toHaveLength(UNIT_CAP);
  });
});
