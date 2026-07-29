import { describe, it, expect } from "vitest";
import { html } from "lit-html";
import { Simulation } from "../../engine/Simulation";
import { dominantGripe, vacateCause } from "../../engine/sim/gripe";
import { GRID } from "../../engine/facilities";
import type { FacilityKind, Unit } from "../../engine/types";
import { gripeLineText } from "../../game/gripeCopy";
import { renderToFragment } from "../../ui/testing/litTestUtils";

/**
 * A nightclub's negative halo reaches across floors, and D18 put the rental
 * Apartment inside it. This file pins that the ATTRIBUTION ladder knows that too:
 * an Apartment eroding from a club must name the club, not fall through to the
 * "access" catch-all and tell a fully served tenant it has no route to the lobby.
 */

const C = Math.floor(GRID.width / 2);

function expectOk<T extends { ok: boolean; reason?: string }>(r: T): T {
  expect(r.ok, r.reason).toBe(true);
  return r;
}

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  const put = (x: number): void => {
    if (sim.tower.structureKindAt(floor, x) === kind) return;
    expectOk(sim.tower.place(kind, floor, x));
  };
  for (let x = C; x < GRID.width; x++) put(x);
  for (let x = C - 1; x >= 0; x--) put(x);
}

function placeUnit(sim: Simulation, kind: FacilityKind, floor: number, x: number): Unit {
  const r = expectOk(sim.tower.place(kind, floor, x));
  const unit = sim.tower.units.find((u) => u.id === r.unitId);
  expect(unit, `no unit for placed ${kind} at floor ${floor}, x ${x}`).toBeDefined();
  return unit!;
}

describe("a nightclub's cross-floor beat is named for the Apartment too (#684)", () => {
  /** A Modern tower with a served Apartment on floor 2 and a nightclub far along
   *  floor 3, so the club is in cross-floor halo range but NOT a same-floor noise
   *  source (noiseAfflicted stays false). That separation is the whole point: it
   *  isolates the halo channel, which is the one the rental branch could not name. */
  function clubTower(kind: "condo" | "rentalApartment"): { sim: Simulation; unit: Unit } {
    const sim = Simulation.newGame(9, "modern");
    sim.money = 1e9;
    sim.star = 5; // rentals unlocked
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 3));
    sim.tower.setCars(sim.tower.transports[0].id, 8);
    const unit = placeUnit(sim, kind, 2, C);
    placeUnit(sim, "nightclub", 3, C - 60); // far along the floor above
    sim.star = 1; // no events during the reads
    unit.state = "occupied";
    unit.everOccupied = true;
    unit.residents = 3;
    expect(sim.noiseAfflicted(unit), "club must NOT be a same-floor source").toBe(false);
    return { sim, unit };
  }

  it("the Apartment's gripe names noise, exactly as the condo's does", () => {
    // Before the fix the rental branch returned null here, so vacateCause fell
    // through to its "access" catch-all and the notice told a fully served tenant
    // "no route to the lobby". The cause it named was false, not merely absent.
    const condo = clubTower("condo");
    const apt = clubTower("rentalApartment");
    expect(dominantGripe(condo.sim, condo.unit)).toBe("noise"); // the control
    expect(dominantGripe(apt.sim, apt.unit)).toBe("noise");
    expect(vacateCause(apt.sim, apt.unit, true, 0)).toBe("noise"); // never the access catch-all
  });

  it("the Apartment's Main gripe line offers the club remedy, not the lobby tile", () => {
    // A lobby tile is the one remedy that cannot work on a cross-floor halo, so
    // printing it would send the player to fix the wrong thing.
    const { sim, unit } = clubTower("rentalApartment");
    const gripe = dominantGripe(sim, unit);
    expect(gripe).toBe("noise"); // the line is only reached once the cause is named
    const text = renderToFragment(html`${gripeLineText(sim, unit, gripe!)}`).textContent ?? "";
    expect(text).toContain("nightclub");
    expect(text).not.toContain("A lobby tile between them shields it."); // the wrong remedy
  });

  it("the forgiving Studio is NOT blamed for a club it does not feel", () => {
    // The Studio stays out of the nightclub halo (D18), so naming a club for it
    // would be the mirror-image error: a cause with no matching drain.
    const sim = Simulation.newGame(9, "modern");
    sim.money = 1e9;
    sim.star = 5;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 3));
    sim.tower.setCars(sim.tower.transports[0].id, 8);
    const studio = placeUnit(sim, "rentalStudio", 2, C);
    placeUnit(sim, "nightclub", 3, C - 60);
    sim.star = 1;
    studio.state = "occupied";
    studio.everOccupied = true;
    expect(sim.noiseAfflicted(studio)).toBe(false);
    expect(dominantGripe(sim, studio)).toBeNull();
  });
});
