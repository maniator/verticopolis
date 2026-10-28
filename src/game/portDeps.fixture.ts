import type { Simulation } from "../engine/Simulation";
import { catalogOf } from "./portAccess";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";
import { ViewReader } from "../simport/viewReader";

/** The engine, codes and reader the game's controllers take as getters, built
 *  over `sim` the way the app builds them. The reader reads as of the last
 *  `update()`, as the app's does, so a test that changes the tower directly
 *  calls `reader.update()` before the controller reads it. */
export function portDeps(sim: Simulation) {
  const engine = new TsEngine(sim);
  const reader = new ViewReader(engine);
  const codes = new PortCodes(engine);
  return {
    engine,
    reader,
    codes,
    /** The deps the controllers share. */
    deps: {
      enginePort: () => engine,
      portCodes: () => codes,
      reader: () => reader,
      catalog: () => catalogOf({ sim, reader }),
      isUnlocked: (kind: Parameters<Simulation["isUnlocked"]>[0]) => sim.isUnlocked(kind),
    },
  };
}
