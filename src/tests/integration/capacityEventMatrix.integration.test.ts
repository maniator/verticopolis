import { describe, expect, it } from "vitest";
import { MAX_CARS } from "../../engine/facilities";

const CAR_LIMIT = MAX_CARS.elevatorStandard!;
import type { GameplayEvent } from "../../engine/gameplayEvents";
import { Simulation } from "../../engine/Simulation";
import { attachWasmHost, type WasmHost } from "../../wasmhost/wasmHost";
import { DualRun } from "../dualrun/dualRunHarness";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * Every way a shaft's capacity can change, on each engine (#906): each
 * mutation reports `capacity_changed` exactly once, with the shaft's kind; a
 * refusal or a no-op reports nothing; the bare tower edits report nothing; and
 * a tower that is swapped (a load, an undo restore) or merged (the WASM
 * host's hour pass) never reports into a buffer it no longer belongs to.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

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

describe.skipIf(!hasWasmPackage())("capacity_changed on the WASM host and in the dual run", () => {
  for (const [what, expected, run, setup] of EDITS) {
    it(`${what}: ${expected} event on the hosted engine`, () => {
      const { sim, shaft } = tower();
      let host: WasmHost | null = attachWasmHost(sim, wasm());
      try {
        setup?.(sim, shaft);
        sim.drainGameplayEvents();
        run(sim, shaft);
        const got = capacity(sim.drainGameplayEvents());
        expect(got).toHaveLength(expected);
        for (const e of got) expect(e.payload).toEqual({ kind: "elevatorStandard" });
        // Nothing is owed at detach, so nothing is reported twice.
        host.detach();
        host = null;
        expect(capacity(sim.drainGameplayEvents())).toHaveLength(0);
      } finally {
        host?.detach();
      }
    });
  }

  it("reports once across the host's hour merge into the instance", () => {
    const { sim, shaft } = tower();
    const host = attachWasmHost(sim, wasm());
    try {
      const merges = host.merges;
      sim.tick(60); // an hour pass: the host merges the engine's save into the instance
      sim.drainGameplayEvents();
      expect(host.merges).toBeGreaterThan(merges);
      expect(sim.setCars(shaft, 2)).toBe(true);
      expect(capacity(sim.drainGameplayEvents())).toHaveLength(1);
      expect(sim.addCar(shaft).ok).toBe(true);
      expect(capacity(sim.drainGameplayEvents())).toHaveLength(1);
    } finally {
      host.detach();
    }
  });

  it("the dual run agrees on every edit, event for event", () => {
    const { sim, shaft } = tower();
    const run = new DualRun().follow(sim);
    // No drain here: the harness compares every event both engines report,
    // setups and resets included, at the next checkpoint.
    let want = 0;
    for (const [, expected, edit, setup] of EDITS) {
      setup?.(sim, shaft);
      edit(sim, shaft);
      want += expected;
      sim.setCars(shaft, 1); // back to one car for the next edit
      sim.resizeTransport(shaft, 1, 2); // and back to the starting span
    }
    sim.tick(60);
    const report = run.stop();
    expect(report.divergences).toEqual([]);
    expect(report.eventDivergences).toEqual([]);
    expect(want).toBeGreaterThan(0);
  });
});
