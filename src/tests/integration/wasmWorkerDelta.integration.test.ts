import { describe, expect, it } from "vitest";
import type { Simulation } from "../../engine/Simulation";
import type { ShadowEngine } from "../../dualrun/shadow";
import type { FromWorker } from "../../wasmhost/workerProtocol";
import { buildScenarios } from "../perfCompare/scenarios";
import { hasWasmPackage } from "../conformance/wasmEngine";
import { fromSave, host, script } from "../wasmWorker/hostDriver";

/**
 * The delta oracle for the worker host's hourly delta (#1045): over the
 * three benchmark towers and two in-game days, after every reply that
 * brought a delta or a full save (every op sent included, since each check
 * runs right after a sync), the read model's own save equals the engine's
 * `serialize()`. A delta that drifted from a full merge in any saved field
 * fails here at the hour it drifted. One run adds player edits that leave
 * the layout alone, so the hours after a command (full saves) and the
 * deltas after them are checked too.
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

/** Player edits between steps: money, a rename, rents up and down, an
 *  office taken off the market, a camera stamp. None moves the layout. */
function edits(step: number, sim: Simulation): void {
  const office = sim.tower.units.find((u) => u.kind === "office");
  if (step === 100) sim.money = sim.money + 250_000;
  if (step === 300) sim.tower.towerName = "Delta Tower";
  if (step === 500 && office) sim.adjustRent(office.id, 1);
  if (step === 700 && office) sim.adjustRent(office.id, -1);
  if (step === 900 && office) sim.setNoRate(office.id);
  if (step === 1100) sim.view = { tile: 140, floor: 3, zoom: 1.5 };
}

const DAY_STEPS = 720; // 2-minute steps at the fastest speed, roughly
const SCENARIOS = buildScenarios();
const RUNS = [...SCENARIOS.map((sc) => ({ sc, edited: false })), { sc: SCENARIOS[1], edited: true }];

describe.skipIf(!hasWasmPackage())("the worker host's hourly delta", () => {
  for (const { sc, edited } of RUNS) {
    it(`keeps the read model equal to the engine's save on the ${sc.name} tower${edited ? ", with player edits" : ""}`, async () => {
      const sim = fromSave(sc.save);
      const h = await host("worker", sim);
      const w = h.worker!;
      const engine = (): ShadowEngine => (w.channel.core as unknown as { shadow: ShadowEngine }).shadow;
      let seen = 0;
      let checked = 0;
      try {
        await script(h, 2 * DAY_STEPS, (step, s) => {
          // The sync before this awaited the reply to every op sent, so the
          // read model is caught up whenever a save half arrived.
          const replies = w.channel.received.filter((m): m is Extract<FromWorker, { type: "frame" }> => m.type === "frame");
          const fresh = replies.slice(seen);
          seen = replies.length;
          if (fresh.some((r) => r.delta || r.merge)) {
            expect(ownSave(s), `after ${w.host.stats.deltas} deltas and ${w.host.stats.merges} full saves`).toEqual(JSON.parse(engine().handle().serialize()));
            checked++;
          }
          if (edited) edits(step, s);
        });
      } finally {
        h.detach();
      }
      expect(w.fatal).toEqual([]);
      expect(w.errors).toEqual([]);
      expect(w.host.stats.deltasRefused).toBe(0);
      expect(checked).toBeGreaterThanOrEqual(40);
      if (!edited) {
        // Two days of hour passes on an unchanged layout: every one goes
        // out as a delta, the first taken against the loaded save.
        expect(w.host.stats.merges).toBe(0);
        expect(w.host.stats.deltas).toBeGreaterThanOrEqual(40);
      } else {
        // The hour after each edit but the camera stamp sends a full save.
        expect(w.host.stats.merges).toBe(5);
        expect(w.host.stats.deltas).toBeGreaterThanOrEqual(35);
      }
    }, 600_000);
  }
});
