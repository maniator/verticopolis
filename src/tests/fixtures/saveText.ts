import { Simulation } from "../../engine/Simulation";
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

/**
 * Give a test's `SaveLoad` deps the engine port pieces, over whatever tower
 * the test's `getSim` answers. A done swap hands the new tower to the deps'
 * `adoptSim`, as the game's `TsEngine.handOff` does, and the port follows
 * `getSim` again on its next use, so a test that keeps its own tower keeps it.
 */
export function withPorts(deps: Omit<SaveLoadDeps, PortDeps>): SaveLoadDeps {
  const engine = new TsEngine(deps.getSim());
  engine.handOff = (next) => {
    engine.take(next);
    deps.adoptSim(next);
  };
  const port = (): TsEngine => {
    engine.take(deps.getSim());
    return engine;
  };
  const codes = new PortCodes(engine);
  const reader = new ViewReader(engine);
  return Object.assign(deps, {
    enginePort: port,
    portCodes: () => codes,
    reader: () => {
      port();
      reader.update();
      return reader;
    },
    towerSwapped: () => {},
  });
}
