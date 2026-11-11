import type { Draft } from "../tests/portKit/drafts";
import { portOf } from "./cardKit.fixture";
import { catalogOf, isUnlocked, newViewReader } from "./portAccess";
import { PortCodes } from "../simport/portCodes";
import type { FacilityKind } from "../shared/types";

/** The engine, codes and reader the game's controllers take as getters, built
 *  over the draft's engine (the Rust engine) the way the app builds them. The
 *  reader reads as of the last `update()`, as the app's does, so a test that
 *  changes the tower directly calls `reader.update()` before a controller
 *  reads it; the engine getter loads the draft's pending edits itself. */
export function portDeps(sim: Draft) {
  const engine = portOf(sim);
  const reader = newViewReader(engine);
  const codes = new PortCodes(engine);
  return {
    engine,
    reader,
    codes,
    /** The deps the controllers share. */
    deps: {
      // Each read loads what the test changed on the draft first, as the
      // app's engine always holds the tower the player sees.
      enginePort: () => portOf(sim),
      portCodes: () => codes,
      reader: () => reader,
      catalog: () => catalogOf({ enginePort: engine, reader }),
      isUnlocked: (kind: FacilityKind) => isUnlocked({ reader }, kind),
    },
  };
}
