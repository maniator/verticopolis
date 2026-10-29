import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import type { EnginePort } from "../simport/enginePort";
import { SaveGame } from "../storage/SaveGame";
import { loadStored } from "./portLifecycle";

/**
 * The engine the game starts on, with the stored tower already loaded into
 * it (PR 5e). Boot builds one for the engine it chose and hands it to
 * `GameApp`, so the app holds a port from its first line and never learns
 * which engine is behind it.
 */
export interface BootTower {
  port: EnginePort;
  /** A save existed but this engine could not read it. */
  corrupt: boolean;
  /** A readable save existed and loaded. */
  loaded: boolean;
  /** When the loaded save was written, when it says. */
  savedAt: number | undefined;
}

/** The seed of the fresh tower an engine starts on, before the stored tower
 *  loads over it. */
export const BOOT_SEED = Date.parse("2024-01-01");

/** Load the stored tower into `port`, which holds a fresh tower. The fresh
 *  tower's events never reach the loaded one (`setBackdrop`). */
export function bootTower(port: EnginePort): BootTower {
  port.setBackdrop(true);
  const boot = SaveGame.loadResult(loadStored(port));
  port.setBackdrop(false);
  return { port, ...boot };
}

/** The TypeScript engine, with the stored tower loaded. */
export function tsBootTower(): BootTower {
  return bootTower(new TsEngine(Simulation.newGame(BOOT_SEED)));
}
