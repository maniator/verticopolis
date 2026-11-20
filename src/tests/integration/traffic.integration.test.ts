import { it, expect } from "vitest";
import { LOT_WIDTH } from "../portKit/draftFixtures";
import { PortSim, describeEngines, type Leg, draftTower, type Draft } from "../portKit/portSim";

/**
 * The engine's per-floor congestion reading (`hotspot`, `floorCongestion`,
 * `congestionCause`): what the ratings, the Map's Traffic view and the
 * morning complaint read. The HUD's Traffic readout follows the live waiting
 * lines instead (owner, 2026-11-17); its rules are
 * `src/presentation/trafficLine.test.ts` and `trafficHud.integration.test.ts`.
 */

/** The reading where a floor's tenants start to leave (the Map's Jammed
 *  line, `CONGESTION_CHURN` in `src/panels/heatmap.rs`). */
const CHURN = 1.0;
/** A healthy tower's peak stays under this. */
const HEALTHY_PEAK = 0.4;

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

describeEngines("The congestion reading is peak-driven and points at the hotspot", (leg: Leg) => {
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
    // The peak flags the jam past the churn line, well above the mean.
    expect(peak).toBeGreaterThan(CHURN);
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
    expect(ratio).toBeGreaterThan(CHURN);
    // The cause of the reading is that one weak shaft.
    expect(sim.congestionCause(1)).toEqual([draft.tower.transports[0].id]);
    expect(sim.congestionCause(1.5)).toEqual([]);
  });

  it("a well-built tower's peak stays low", () => {
    const draft = draftTower(2);
    draft.money = 1e12;
    lay(draft, "lobby", 1);
    for (let f = 2; f <= 12; f++) lay(draft, "floor", f);
    for (let i = 0; i < 4; i++) {
      const r = draft.buildTransport("elevatorStandard", W - 6 - i * 6, 1, 12);
      if (r.ok) draft.tower.setCars(draft.tower.transports[i].id, 8);
    }
    for (let f = 2; f <= 12; f++) fillFloor(draft, f, 12);
    expect(new PortSim(leg, draft).hotspot().ratio).toBeLessThan(HEALTHY_PEAK);
  });

  it("the hotspot names no floor (not 0, a real floor) when nothing is congested", () => {
    const draft = draftTower(3);
    draft.money = 1e12;
    lay(draft, "lobby", 1);
    const { ratio, floor } = new PortSim(leg, draft).hotspot();
    expect(ratio).toBe(0);
    expect(floor).toBeUndefined(); // no floor, so it never collides with floor 0 (B1)
  });

  it("the hotspot ratio is the true per-floor max", () => {
    // The overlay's peak reads the hotspot ratio: it must equal the worst
    // floor's congestion and dominate every other floor.
    const sim = hotspotTower();
    const { ratio, floor } = sim.hotspot();
    expect(ratio).toBeCloseTo(sim.floorCongestion(floor!), 10);
    for (let f = 2; f <= 20; f++) {
      expect(sim.floorCongestion(f)).toBeLessThanOrEqual(ratio + 1e-9);
    }
  });
});
