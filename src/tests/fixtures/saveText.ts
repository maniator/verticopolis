import { Simulation } from "../../engine/Simulation";
import { facilityFloors } from "../../engine/facilities";
import { TsEngine } from "../../engine/port/tsEngine";
import { SaveGame } from "../../storage/SaveGame";
import { loadStored } from "../../game/portLifecycle";
import type { SaveLoadDeps } from "../../game/saveLoad";
import { PortCodes } from "../../simport/portCodes";
import { ViewReader } from "../../simport/viewReader";

/**
 * `SaveGame` speaks save text and hands loads to the engine (PR 5d). These
 * helpers give the storage tests the shapes they check: the text a tower
 * saves as, and the tower a load hands the engine (a `TsEngine`, so the
 * founder rule applies as in the game).
 */

/** The save text of a tower, as `EnginePort.serialize()` writes it. */
export const saveOf = (sim: { serialize(): unknown }): string => JSON.stringify(sim.serialize());

/** The tower the autosave loads into a fresh engine, with the read's flags. */
export function loadResultSim(): { sim: Simulation | null; corrupt: boolean; savedAt: number | undefined } {
  const engine = new TsEngine(Simulation.newGame(1));
  const { loaded, corrupt, savedAt } = SaveGame.loadResult(loadStored(engine));
  return { sim: loaded ? engine.sim : null, corrupt, savedAt };
}

/** The tower the autosave loads, or null. */
export const loadAuto = (): Simulation | null => loadResultSim().sim;

/** The tower manual slot `n` loads, or null. */
export function loadSlotSim(n: number): Simulation | null {
  const engine = new TsEngine(Simulation.newGame(1));
  return SaveGame.loadSlot(n, loadStored(engine)) ? engine.sim : null;
}

type PortDeps = "enginePort" | "portCodes" | "reader" | "towerSwapped";

/** A test's own tower, and where a swap's new tower goes. */
interface TestTower {
  getSim(): Simulation;
  adoptSim(sim: Simulation): void;
}

/**
 * Give a test's `SaveLoad` deps the engine port pieces, over whatever tower
 * the test's `getSim` answers. A done swap hands the new tower to the test's
 * `adoptSim` when `SaveLoad` reports it (`towerSwapped`, as the game follows
 * a swap), and the port follows `getSim` again on its next use, so a test
 * that keeps its own tower keeps it.
 */
export function withPorts(deps: Omit<SaveLoadDeps, PortDeps> & TestTower): SaveLoadDeps {
  const engine = new TsEngine(deps.getSim());
  const port = (): TsEngine => {
    engine.take(deps.getSim());
    return engine;
  };
  const codes = new PortCodes(engine);
  const reader = new ViewReader(engine, facilityFloors);
  return Object.assign(deps, {
    enginePort: port,
    portCodes: () => codes,
    reader: () => {
      port();
      reader.update();
      return reader;
    },
    towerSwapped: () => deps.adoptSim(engine.sim),
  });
}
