import { describe, it, expect } from "vitest";
import { Tower } from "../Tower";
import { Simulation } from "../Simulation";
import type { FacilityKind } from "../types";
import { METRO_PLATFORM_CUTOFF_MSG } from "./constants";

/**
 * The daily "metro platform cut off" advisory (issue #315). An operational
 * metro whose platform (the station's middle story, `floor + 1`) has no
 * PASSENGER transport reaching it draws no commuters at all, and there is no
 * other on-screen symptom, so `nudgeMetroPlatform` posts one quiet log line to
 * tell the player why their expensive station is inert. It shares the
 * `isMetroPlatformServed` routing predicate with the commuter spawn guard and
 * the visit-origin path, so a staff-only service elevator (which never carries
 * commuters) counts as no transport here too.
 */

/** A full-lot deep basement with an operational metro on stories -3..-1
 *  (platform on -2), optionally with one transport shaft rising from the
 *  platform. Mirrors the crowd venueTrips fixture so the placement is identical
 *  to the one the commuter path is tested against. */
function metroTower(shaft: FacilityKind | "none"): Tower {
  const tower = new Tower();
  // Assert every placement (repo convention, AGENTS.md): a fixture that silently
  // skips a failed place would degrade into a confusing null-deref downstream.
  const must = (kind: FacilityKind, f: number, x: number): number => {
    const r = tower.place(kind, f, x);
    if (!r.ok || r.unitId == null) throw new Error(`fixture place ${kind} @ floor ${f}, x ${x} failed: ${r.reason}`);
    return r.unitId;
  };
  for (let x = 0; x < 375; x++) must("lobby", 1, x);
  for (const f of [0, -1, -2, -3]) for (let x = 0; x < 375; x++) must("floor", f, x);
  tower.getUnit(must("metro", -3, 0))!.state = "occupied";
  if (shaft !== "none") {
    const res = tower.placeTransport(shaft, 4, -2, 1); // platform (-2) up to the ground lobby
    if (!res.ok) throw new Error(`fixture shaft failed: ${res.reason}`);
  }
  return tower;
}

function simWith(shaft: FacilityKind | "none"): Simulation {
  const sim = Simulation.newGame(1);
  sim.tower = metroTower(shaft);
  return sim;
}

describe("nudgeMetroPlatform", () => {
  it("posts the cutoff advisory once when the platform has no transport, then latches", () => {
    const sim = simWith("none");

    sim.nudgeMetroPlatform();
    expect(sim.log.filter((e) => e.text === METRO_PLATFORM_CUTOFF_MSG)).toHaveLength(1);
    expect(sim.metroPlatformNudged).toBe(true);

    // Latched: a second day with the platform still cut off does not repeat it.
    sim.nudgeMetroPlatform();
    expect(sim.log.filter((e) => e.text === METRO_PLATFORM_CUTOFF_MSG)).toHaveLength(1);
  });

  it("stays silent when a passenger elevator reaches the platform", () => {
    const sim = simWith("elevatorStandard");
    sim.nudgeMetroPlatform();
    expect(sim.log.some((e) => e.text === METRO_PLATFORM_CUTOFF_MSG)).toBe(false);
    expect(sim.metroPlatformNudged).toBe(false);
  });

  it("still fires when only a staff-only service elevator reaches the platform", () => {
    // Service elevators never carry commuters, so the platform is still orphaned.
    const sim = simWith("elevatorService");
    sim.nudgeMetroPlatform();
    expect(sim.log.filter((e) => e.text === METRO_PLATFORM_CUTOFF_MSG)).toHaveLength(1);
    expect(sim.metroPlatformNudged).toBe(true);
  });

  it("re-arms after a passenger shaft reaches a previously cut-off platform", () => {
    const sim = simWith("none");
    sim.nudgeMetroPlatform();
    expect(sim.metroPlatformNudged).toBe(true);

    // Connect the platform; the latch clears and nothing new is posted.
    const res = sim.tower.placeTransport("elevatorStandard", 4, -2, 1);
    if (!res.ok) throw new Error(`connect shaft failed: ${res.reason}`);
    sim.nudgeMetroPlatform();
    expect(sim.metroPlatformNudged).toBe(false);
    expect(sim.log.filter((e) => e.text === METRO_PLATFORM_CUTOFF_MSG)).toHaveLength(1);
  });
});
