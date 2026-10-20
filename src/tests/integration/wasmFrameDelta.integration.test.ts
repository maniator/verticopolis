import { describe, expect, it } from "vitest";
import type { Simulation } from "../../engine/Simulation";
import { buildScenarios } from "../perfCompare/scenarios";
import { hasWasmPackage } from "../conformance/wasmEngine";
import { fromSave, host, script } from "../wasmWorker/hostDriver";

/**
 * MEASUREMENT PROTOTYPE, never merged: the delta oracle for the coalesced
 * main-thread host taking the engine's hourly save delta (#1068's binding).
 * Over the three benchmark towers and two in-game days, after every sync
 * that applied a delta or a full merge, the read model's own save equals the
 * engine's `serialize()`. It proves the prototype measures a correct sync,
 * not only a fast one.
 */

/** The read model's own save (while hosted, `serialize` is the host's). */
function ownSave(sim: Simulation): unknown {
  const own = Object.getOwnPropertyDescriptor(sim, "serialize");
  if (own) delete (sim as Partial<Simulation>).serialize;
  try {
    return JSON.parse(JSON.stringify(sim.serialize()));
  } finally {
    if (own) Object.defineProperty(sim, "serialize", own);
  }
}

/** Player edits between steps that leave the layout alone. */
function edits(step: number, sim: Simulation): void {
  const office = sim.tower.units.find((u) => u.kind === "office");
  if (step === 100) sim.money = sim.money + 250_000;
  if (step === 300) sim.tower.towerName = "Delta Tower";
  if (step === 500 && office) sim.adjustRent(office.id, 1);
  if (step === 700 && office) sim.adjustRent(office.id, -1);
  if (step === 900 && office) sim.setNoRate(office.id);
  if (step === 1100) sim.view = { tile: 140, floor: 3, zoom: 1.5 };
}

const DAY_STEPS = 720;
const SCENARIOS = buildScenarios();
const RUNS = [...SCENARIOS.map((sc) => ({ sc, edited: false })), { sc: SCENARIOS[1], edited: true }];

describe.skipIf(!hasWasmPackage())("the coalesced main-thread host's hourly delta (prototype)", () => {
  for (const { sc, edited } of RUNS) {
    it(`keeps the read model equal to the engine's save on the ${sc.name} tower${edited ? ", with player edits" : ""}`, async () => {
      const sim = fromSave(sc.save);
      const h = await host("frame", sim);
      const main = h.main!;
      let syncs = main.merges + main.deltas;
      let checked = 0;
      try {
        await script(h, 2 * DAY_STEPS, (step, s) => {
          const now = main.merges + main.deltas;
          if (now !== syncs) {
            expect(ownSave(s), `after ${main.deltas} deltas and ${main.merges} full merges`).toEqual(JSON.parse(main.engine.serialize()));
            checked++;
            syncs = now;
          }
          if (edited) edits(step, s);
        });
      } finally {
        h.detach();
      }
      expect(checked).toBeGreaterThanOrEqual(40);
      // The first sync after the attach is a keyframe; every later hour pass
      // on an unchanged layout is a delta, except the hour after an edit
      // outside KEYFRAME_EXEMPT_OPS. The camera stamp and the rename are
      // exempt, so the edited run's full merges are the keyframe plus the
      // money, the two rent changes and the no-rate edit.
      if (!edited) {
        expect(main.merges).toBe(1);
        expect(main.deltas).toBeGreaterThanOrEqual(40);
      } else {
        expect(main.merges).toBe(5);
        expect(main.deltas).toBeGreaterThanOrEqual(35);
      }
    }, 600_000);
  }
});
