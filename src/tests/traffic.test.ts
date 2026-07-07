import { describe, it, expect } from "vitest";
import { trafficTier, TRAFFIC_LABELS, trafficGlyph } from "../engine/traffic";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}
function fillFloor(sim: Simulation, floor: number, count: number): void {
  let placed = 0;
  for (let x = 0; x + 9 <= W && placed < count; x += 9) {
    const r = sim.tower.place("office", floor, x);
    if (r.ok) {
      sim.tower.getUnit(r.unitId!)!.state = "occupied"; // O(1) map lookup, clearer than a scan
      placed++;
    }
  }
}

describe("Traffic tier (color-blind cue)", () => {
  it("maps PEAK congestion to the 4-tier ladder at the calibrated boundaries", () => {
    // Boundaries derived from measured towers: well-built peaks ~0.2–0.3 (Smooth),
    // a tightening tower 0.4–0.8 (Busy), an overloaded floor 0.8–1.5 (Backed up),
    // a real jam 1.5+ (Gridlock).
    expect(trafficTier(0)).toBe(0); // Smooth
    expect(trafficTier(0.29)).toBe(0); // a healthy real tower's peak
    expect(trafficTier(0.39)).toBe(0);
    expect(trafficTier(0.4)).toBe(1); // Busy at exactly 0.4
    expect(trafficTier(0.8)).toBe(1); // still Busy AT the boundary
    expect(trafficTier(0.81)).toBe(2); // Backed up
    expect(trafficTier(1.5)).toBe(2); // Backed up AT the boundary
    expect(trafficTier(1.51)).toBe(3); // Gridlock
    expect(trafficTier(3.1)).toBe(3); // a severe jam
  });
  it("glyph is shape-coded (fills to the tier) and grayscale-legible", () => {
    expect(trafficGlyph(0)).toBe("▮▯▯▯");
    expect(trafficGlyph(3)).toBe("▮▮▮▮");
    expect(TRAFFIC_LABELS[trafficTier(2.0)]).toBe("Gridlock");
  });
});

describe("Traffic signal is peak-driven and points at the hotspot", () => {
  /** A tower with 8 lightly-loaded floors served by a strong shaft (zone A) plus
   *  3 floors packed onto a single weak shaft (zone B), transferring at floor 10.
   *  Zone B is a real jam; zone A dilutes the average but not the peak. */
  function hotspotTower(): Simulation {
    const sim = Simulation.newGame(1);
    sim.simModel = "v2";
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 20; f++) lay(sim, "floor", f);
    expect(sim.buildTransport("elevatorStandard", W - 6, 1, 10).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[0].id, 8); // strong shaft, low zone
    expect(sim.buildTransport("elevatorStandard", W - 12, 10, 20).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[1].id, 1); // weak shaft, high zone
    for (let f = 2; f <= 9; f++) fillFloor(sim, f, 12); // healthy zone A
    for (const f of [11, 12, 13]) fillFloor(sim, f, 30); // jammed zone B
    return sim;
  }

  it("a localized jam reads as a high tier on PEAK where the AVERAGE would understate it", () => {
    const sim = hotspotTower();
    const avg = sim.congestion();
    const peak = sim.peakCongestion();
    expect(peak).toBeGreaterThan(avg); // the jam is hidden in the mean
    // The chip (peak) flags the jam; feeding the average would report a lower tier.
    expect(trafficTier(peak)).toBeGreaterThanOrEqual(2); // Backed up or Gridlock
    expect(trafficTier(peak)).toBeGreaterThan(trafficTier(avg));
  });

  it("names the busiest floor — the argmax of the per-floor congestion map", () => {
    const sim = hotspotTower();
    const floor = sim.peakCongestionFloor();
    expect(floor).not.toBeNull();
    expect([11, 12, 13]).toContain(floor); // the jam is in zone B
    // It is exactly the floor whose congestion equals the peak.
    expect(sim.congestionAt(floor!)).toBeCloseTo(sim.peakCongestion(), 5);
  });

  it("a well-built tower stays Smooth and names no floor (peak below the first boundary)", () => {
    const sim = Simulation.newGame(2);
    sim.simModel = "v2";
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 12; f++) lay(sim, "floor", f);
    for (let i = 0; i < 4; i++) {
      const r = sim.buildTransport("elevatorStandard", W - 6 - i * 6, 1, 12);
      if (r.ok) sim.tower.setCars(sim.tower.transports[i].id, 8);
    }
    for (let f = 2; f <= 12; f++) fillFloor(sim, f, 12);
    expect(trafficTier(sim.peakCongestion())).toBe(0); // Smooth
  });

  it("peakCongestionFloor is null (not 0 — a real floor) when nothing is congested", () => {
    const sim = Simulation.newGame(3);
    sim.simModel = "v2";
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    expect(sim.peakCongestion()).toBe(0);
    expect(sim.peakCongestionFloor()).toBeNull(); // null, so it never collides with floor 0 (B1)
  });

  it("chip and overlay legend read the same signal — peakCongestion is the true per-floor max", () => {
    // Both consumers read sim.peakCongestion(): the HUD chip tiers on it, the
    // congestion overlay legend reports it. It must equal the worst floor's
    // congestion and dominate every other floor — the one value both surface.
    const sim = hotspotTower();
    const floor = sim.peakCongestionFloor()!;
    expect(sim.peakCongestion()).toBeCloseTo(sim.congestionAt(floor), 10);
    for (let f = 2; f <= 20; f++) {
      expect(sim.congestionAt(f)).toBeLessThanOrEqual(sim.peakCongestion() + 1e-9);
    }
  });
});
