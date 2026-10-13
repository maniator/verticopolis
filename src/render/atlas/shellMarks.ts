import type { LayerHook } from "../pixelSprites/layers";
import { LayerError } from "./pixels";

/**
 * The layer marks of one shell pass (`browserEntry.ts` `renderShell`), apart
 * from the canvas so the rules are testable: `save` runs at the break, and
 * `restore` at the first end after it (or when the paint finishes without
 * one), so whatever the paint draws after the end lands on the shell.
 *
 * A paint with no split (a vacancy card, a shutter) still passes its
 * wrapper's end (`drawRoom`, `drawUnit`); that end is ignored. A second
 * break, or a break after such an end, is a misplaced mark and throws.
 */
export function shellMarks(save: () => void, restore: () => void): { hook: LayerHook; finish(): boolean } {
  let broke = false;
  let ended = false;
  let endedFlat = false;
  return {
    hook: {
      shellEnd() {
        if (broke) throw new LayerError("two layer breaks in one paint");
        if (endedFlat) throw new LayerError("a layer break after a layer end");
        broke = true;
        save();
      },
      furnitureEnd() {
        if (ended) return; // a routine's own end, then its wrapper's: the first counts
        if (!broke) {
          endedFlat = true;
          return;
        }
        ended = true;
        restore();
      },
    },
    /** Call when the paint returns: true when it split. */
    finish() {
      if (broke && !ended) {
        ended = true;
        restore();
      }
      return broke;
    },
  };
}
