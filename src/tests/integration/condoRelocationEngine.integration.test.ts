import { it, expect } from "vitest";
import { newSeededGame, lay } from "../fixtures/towerFixtures";
import { GRID } from "../../engine/facilities";
import type { GameMode } from "../../shared/types";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/** Household-aware condo departures (Modern only), on both engines. Moved from
 *  condoRelocation.integration.test.ts, where they ran on the sampled v1 model.
 *  The engine runs the hourly model only, which rolls the relocation once per
 *  maintenance period at the day boundary, so one month of ticks still gives
 *  each sold condo a month's worth of rolls. */

const C = Math.floor(GRID.width / 2);
/** One 30-day month. */
const MONTH = 60 * 24 * 30;

/** A served floor-2 tower holding one already-sold condo, happy and full, with
 *  the condo's id. `edit` adjusts the condo on the draft before the load. */
function towerWithSoldCondo(
  leg: Leg,
  mode: GameMode,
  residents: number,
  edit: (condo: Record<string, unknown>) => void = () => {},
): { sim: PortSim; id: number } {
  const draft = newSeededGame(4, mode);
  draft.money = 10_000_000;
  draft.star = 1; // suppress random fire/bomb events
  lay(draft, "lobby", 1);
  lay(draft, "floor", 2);
  draft.buildTransport("elevatorStandard", C, 1, 2);
  const r = draft.tower.place("condo", 2, C + 2);
  const condo = draft.tower.units.find(
    (u) => u.id === r.unitId,
  )! as unknown as Record<string, unknown>;
  condo.state = "occupied";
  condo.everOccupied = true;
  condo.residents = mode === "modern" ? residents : undefined;
  condo.satisfaction = 1;
  edit(condo);
  return { sim: new PortSim(leg, draft), id: r.unitId! };
}

/** The condo as the engine's save holds it now. */
function condoOf(
  sim: PortSim,
  id: number,
): { state: string; everOccupied: boolean; vacateReason?: string } {
  return sim.state.tower.units.find((u) => u.id === id)! as unknown as {
    state: string;
    everOccupied: boolean;
    vacateReason?: string;
  };
}

describeEngines(
  "condo relocation is Modern-only and rides the buy-back",
  (leg: Leg) => {
    it("Modern: a happy sold condo eventually relocates (and the buy-back is charged)", () => {
      const { sim, id } = towerWithSoldCondo(leg, "modern", 5); // max flight risk
      const before = sim.state.money;
      // Capture the notice log the first month it fires (the log is a bounded ring,
      // and re-sales over many months would otherwise shift the entry out).
      let relocationLog: { text: string; kind: string } | undefined;
      for (let m = 0; m < 360; m++) {
        sim.tick(MONTH);
        const condo = condoOf(sim, id);
        if (!relocationLog && condo.vacateReason === "relocation") {
          relocationLog = sim.state.log.find((e) =>
            e.text.includes("is relocating"),
          );
        }
        // Relocated and bought back. The notice runs under a month, so by the
        // month after it fires the household has left (the condo may already
        // be re-sold).
        if (
          condo.state === "empty" ||
          (relocationLog && condo.vacateReason !== "relocation")
        )
          break;
      }
      // The advance warning must surface as a toast, so the notice is emitted "bad"
      // (the UI toasts only "good" and "bad" entries).
      expect(relocationLog).toBeDefined();
      expect(relocationLog!.kind).toBe("bad");
      expect(sim.state.money).toBeLessThan(before); // the reclaim (buy-back) was charged
    }, 60_000);

    // Thirty years on the hourly model take over a minute on the TypeScript leg,
    // hence the long timeout.
    it("Classic: a sold condo never relocates over decades (stays 1994-sticky)", () => {
      const { sim, id } = towerWithSoldCondo(leg, "classic", 3);
      for (let m = 0; m < 360; m++) {
        sim.tick(MONTH);
        expect(condoOf(sim, id).vacateReason).not.toBe("relocation");
      }
      // Never relocated: the household is still in place after three decades.
      expect(condoOf(sim, id).state).toBe("occupied");
      expect(condoOf(sim, id).everOccupied).toBe(true);
    }, 300_000);

    it("Classic never draws the relocation roll from the RNG (Modern does)", () => {
      // Same seed, same single sold condo, one month. Modern draws the relocation
      // roll (chance > 0); Classic short-circuits before the draw (chance 0), so
      // after one month the two seeded streams are out of step. If Classic ever
      // drew here (a broken short-circuit) the streams would stay in lockstep.
      const classic = towerWithSoldCondo(leg, "classic", 3).sim;
      const modern = towerWithSoldCondo(leg, "modern", 3).sim;
      expect(classic.state.rng.seed).toBe(modern.state.rng.seed); // identical starting state
      classic.tick(MONTH);
      modern.tick(MONTH);
      expect(classic.state.rng.seed).not.toBe(modern.state.rng.seed); // Modern consumed the extra draw
    });

    it("Modern is deterministic: the same seed relocates on the same month", () => {
      const monthOf = (): number => {
        const { sim, id } = towerWithSoldCondo(leg, "modern", 5);
        for (let m = 0; m < 360; m++) {
          sim.tick(MONTH);
          if (condoOf(sim, id).vacateReason === "relocation") return m;
        }
        return -1;
      };
      const a = monthOf();
      expect(a).toBeGreaterThanOrEqual(0);
      expect(monthOf()).toBe(a);
    }, 60_000);
  },
);

describeEngines(
  "a relocation notice is non-rescindable (a life event)",
  (leg: Leg) => {
    it("a fully satisfied Modern condo on a relocation notice still leaves", () => {
      const { sim, id } = towerWithSoldCondo(leg, "modern", 4, (condo) => {
        condo.state = "vacating";
        condo.vacateReason = "relocation";
        condo.satisfaction = 1; // perfectly happy: a neglect notice would rescind here
        condo.vacateAt = 0; // overdue
      });
      const before = sim.state.money;
      sim.tick(60);
      expect(condoOf(sim, id).state).not.toBe("occupied"); // did not rescind despite full satisfaction
      expect(sim.state.money).toBeLessThan(before); // bought back on departure
    });

    it("a neglect notice at full satisfaction DOES rescind (contrast)", () => {
      const { sim, id } = towerWithSoldCondo(leg, "modern", 4, (condo) => {
        condo.state = "vacating";
        condo.vacateReason = "access";
        condo.satisfaction = 1; // recovered
        condo.vacateAt = 0;
      });
      sim.tick(60);
      expect(condoOf(sim, id).state).toBe("occupied"); // a fixable cause rescinds
    });
  },
);
