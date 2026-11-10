import { describe, expect, it } from "vitest";
import { MAX_CARS } from "../../engine/facilities";

const CAR_LIMIT = MAX_CARS.elevatorStandard!;
import type { GameplayEvent } from "../../events/gameplayEvents";
import { Simulation } from "../../engine/Simulation";

/**
 * Every way a shaft's capacity can change, on each engine (#906): each
 * mutation reports `capacity_changed` exactly once, with the shaft's kind; a
 * refusal or a no-op reports nothing; the bare tower edits report nothing; and
 * a tower that is swapped (a load, an undo restore) never reports into a
 * buffer it no longer belongs to. The Rust engine's own tests hold the same
 * rules (`price_and_capacity_edits_report_changes_and_not_no_ops` in
 * `engine-rs/src/gameplay/tests.rs`, and
 * `paid_edits_report_capacity_changed_and_refusals_report_nothing` in
 * `engine-rs/src/charges_tests.rs`).
 */

type Step = (sim: Simulation, shaft: number) => unknown;
/** What the case does, how many capacity_changed it must report, and the
 *  setup that puts the shaft in the state the case needs (its own events are
 *  drained before the case runs). */
type Edit = [what: string, expected: number, run: Step, setup?: Step];

/** A founded tower with one standard elevator on floors 1-2 and room to grow. */
function tower(seed = 51): { sim: Simulation; shaft: number } {
  const sim = Simulation.newGame(seed, "classic");
  sim.money = 1e9;
  for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (const f of [2, 3, 4]) for (let x = 170; x < 200; x++) expect(sim.build("floor", f, x).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
  return { sim, shaft: sim.tower.transportAt(1, 172)!.id };
}

const capacity = (events: GameplayEvent[]) => events.filter((e) => e.name === "capacity_changed");

const EDITS: Edit[] = [
  ["setCars to a new count", 1, (sim, id) => sim.setCars(id, 2)],
  ["setCars to the same count", 0, (sim, id) => sim.setCars(id, sim.tower.transportById(id)!.cars)],
  ["setCars past the limit (clamped to it)", 1, (sim, id) => sim.setCars(id, CAR_LIMIT + 1)],
  ["setCars past the limit when already at it", 0, (sim, id) => sim.setCars(id, CAR_LIMIT + 1), (sim, id) => sim.setCars(id, CAR_LIMIT)],
  ["setCars on a missing shaft", 0, (sim) => sim.setCars(987_654, 2)],
  ["resizeTransport up a floor", 1, (sim, id) => sim.resizeTransport(id, 1, 3)],
  ["resizeTransport to the same span", 0, (sim, id) => sim.resizeTransport(id, 1, 2)],
  ["resizeTransport onto missing floors", 0, (sim, id) => sim.resizeTransport(id, 1, 40)],
  ["addCar", 1, (sim, id) => sim.addCar(id)],
  ["addCar while broke", 0, (sim, id) => {
    const money = sim.money;
    sim.money = 0;
    const r = sim.addCar(id);
    sim.money = money;
    return r;
  }],
  ["addCar at the car limit", 0, (sim, id) => sim.addCar(id), (sim, id) => sim.setCars(id, CAR_LIMIT)],
  ["removeCar", 1, (sim, id) => sim.removeCar(id), (sim, id) => sim.setCars(id, 3)],
  ["removeCar on the last car", 0, (sim, id) => sim.removeCar(id)],
  ["extendTransport up a floor", 1, (sim, id) => sim.extendTransport(id, "up", 3)],
  ["extendTransport to where it already reaches", 0, (sim, id) => sim.extendTransport(id, "up", 2)],
  ["extendTransport while broke", 0, (sim, id) => {
    const money = sim.money;
    sim.money = 0;
    const r = sim.extendTransport(id, "up", 3);
    sim.money = money;
    return r;
  }],
  ["bare tower.setCars", 0, (sim, id) => sim.tower.setCars(id, 2)],
  ["bare tower.resizeTransport", 0, (sim, id) => sim.tower.resizeTransport(id, 1, 3)],
];

describe("capacity_changed on the TypeScript engine", () => {
  for (const [what, expected, run, setup] of EDITS) {
    it(`${what}: ${expected} event`, () => {
      const { sim, shaft } = tower();
      setup?.(sim, shaft);
      sim.drainGameplayEvents();
      run(sim, shaft);
      const got = capacity(sim.drainGameplayEvents());
      expect(got).toHaveLength(expected);
      for (const e of got) expect(e.payload).toEqual({ kind: "elevatorStandard" });
    });
  }

  it("a loaded or restored tower reports only into its own simulation", () => {
    const { sim, shaft } = tower();
    sim.drainGameplayEvents();
    const restored = Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())));
    restored.drainGameplayEvents();
    expect(restored.setCars(shaft, 2)).toBe(true);
    expect(capacity(restored.drainGameplayEvents())).toHaveLength(1);
    expect(capacity(sim.drainGameplayEvents())).toHaveLength(0);
    // The original still reports for itself, once.
    expect(sim.setCars(shaft, 3)).toBe(true);
    expect(capacity(sim.drainGameplayEvents())).toHaveLength(1);
    expect(capacity(restored.drainGameplayEvents())).toHaveLength(0);
  });

  it("a tower swapped onto a simulation reports through that simulation", () => {
    const { sim, shaft } = tower();
    const donor = Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())));
    sim.tower = donor.tower; // what a merge or an adopt does to the instance
    sim.drainGameplayEvents();
    donor.drainGameplayEvents();
    expect(sim.setCars(shaft, 2)).toBe(true);
    expect(capacity(sim.drainGameplayEvents())).toHaveLength(1);
    expect(capacity(donor.drainGameplayEvents())).toHaveLength(0);
  });
});
