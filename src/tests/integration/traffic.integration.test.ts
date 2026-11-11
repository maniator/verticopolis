import { describe, it, expect } from "vitest";
import { trafficTier, TRAFFIC_LABELS, trafficLevel } from "../../presentation/traffic";
import { LOT_WIDTH } from "../portKit/draftFixtures";
import { PortSim, describeEngines, type Leg, draftTower, type Draft } from "../portKit/portSim";

const W = LOT_WIDTH;
const C = Math.floor(W / 2);
function lay(sim: Draft, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}
function fillFloor(sim: Draft, floor: number, count: number): void {
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
  it("names the meter level the stylesheet fills to (four bars at Gridlock)", () => {
    expect(trafficLevel(0)).toBe("smooth");
    expect(trafficLevel(3)).toBe("gridlock");
    expect(TRAFFIC_LABELS[trafficTier(2.0)]).toBe("Gridlock");
  });
});

describeEngines("Traffic signal is peak-driven and points at the hotspot", (leg: Leg) => {
  /** A tower with 8 lightly-loaded floors served by a strong shaft (zone A) plus
   *  3 floors packed onto a single weak shaft (zone B), transferring at floor 10.
   *  Zone B is a real jam; zone A dilutes the average but not the peak. The
   *  draft is the fixture's authoring copy; the engine starts from its save. */
  function hotspotTower(): PortSim {
    const sim = draftTower(1);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 20; f++) lay(sim, "floor", f);
    expect(sim.buildTransport("elevatorStandard", W - 6, 1, 10).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[0].id, 8); // strong shaft, low zone
    expect(sim.buildTransport("elevatorStandard", W - 12, 10, 20).ok).toBe(true);
    sim.tower.setCars(sim.tower.transports[1].id, 1); // weak shaft, high zone
    for (let f = 2; f <= 9; f++) fillFloor(sim, f, 12); // healthy zone A
    for (const f of [11, 12, 13]) fillFloor(sim, f, 30); // jammed zone B
    return new PortSim(leg, sim);
  }

  it("a localized jam reads as a high tier on PEAK where the AVERAGE would understate it", () => {
    const sim = hotspotTower();
    const avg = sim.congestion();
    const peak = sim.hotspot().ratio;
    expect(peak).toBeGreaterThan(avg); // the jam is hidden in the mean
    // The chip (peak) flags the jam; feeding the average would report a lower tier.
    expect(trafficTier(peak)).toBeGreaterThanOrEqual(2); // Backed up or Gridlock
    expect(trafficTier(peak)).toBeGreaterThan(trafficTier(avg));
  });

  it("names the busiest floor: the argmax of the per-floor congestion map", () => {
    const sim = hotspotTower();
    const { ratio, floor } = sim.hotspot();
    expect(floor).toBeDefined();
    expect([11, 12, 13]).toContain(floor); // the jam is in zone B
    // It is exactly the floor whose congestion equals the peak.
    expect(sim.floorCongestion(floor!)).toBeCloseTo(ratio, 5);
  });

  it("names the ground lobby (1F) when a lobby-served bank is the bottleneck", () => {
    // The off-by-one report: a single weak shaft carries a whole office stack up
    // from the lobby. Every floor it serves shares that one bottleneck, so they
    // all tie, and the lobby is where riders board it. The hotspot must be floor
    // 1 (the "1F" the player sees backed up), not the first office floor above.
    const draft = draftTower(7);
    draft.money = 1e12;
    lay(draft, "lobby", 1);
    for (let f = 2; f <= 10; f++) lay(draft, "floor", f);
    expect(draft.buildTransport("elevatorStandard", W - 6, 1, 10).ok).toBe(true);
    draft.tower.setCars(draft.tower.transports[0].id, 1); // one weak shaft, lobby-served
    for (let f = 2; f <= 10; f++) fillFloor(draft, f, 30); // a heavy office stack
    const sim = new PortSim(leg, draft);
    const { ratio, floor } = sim.hotspot();
    expect(floor).toBe(1); // the lobby, not 2F
    // The lobby's reading is the true per-floor max, and it carries the boarding
    // pressure the office floors above share, not a signal of its own residents.
    expect(sim.floorCongestion(1)).toBeCloseTo(ratio, 10);
    expect(trafficTier(ratio)).toBeGreaterThanOrEqual(2);
  });

  it("a well-built tower stays Smooth and names no floor (peak below the first boundary)", () => {
    const draft = draftTower(2);
    draft.money = 1e12;
    lay(draft, "lobby", 1);
    for (let f = 2; f <= 12; f++) lay(draft, "floor", f);
    for (let i = 0; i < 4; i++) {
      const r = draft.buildTransport("elevatorStandard", W - 6 - i * 6, 1, 12);
      if (r.ok) draft.tower.setCars(draft.tower.transports[i].id, 8);
    }
    for (let f = 2; f <= 12; f++) fillFloor(draft, f, 12);
    expect(trafficTier(new PortSim(leg, draft).hotspot().ratio)).toBe(0); // Smooth
  });

  it("the hotspot names no floor (not 0, a real floor) when nothing is congested", () => {
    const draft = draftTower(3);
    draft.money = 1e12;
    lay(draft, "lobby", 1);
    const { ratio, floor } = new PortSim(leg, draft).hotspot();
    expect(ratio).toBe(0);
    expect(floor).toBeUndefined(); // no floor, so it never collides with floor 0 (B1)
  });

  it("chip and overlay legend read the same signal: the hotspot ratio is the true per-floor max", () => {
    // Both consumers read the hotspot ratio: the HUD chip tiers on it, the
    // congestion overlay legend reports it. It must equal the worst floor's
    // congestion and dominate every other floor, the one value both surface.
    const sim = hotspotTower();
    const { ratio, floor } = sim.hotspot();
    expect(ratio).toBeCloseTo(sim.floorCongestion(floor!), 10);
    for (let f = 2; f <= 20; f++) {
      expect(sim.floorCongestion(f)).toBeLessThanOrEqual(ratio + 1e-9);
    }
  });
});
