import { UndoHistory } from "../engine/UndoHistory";
import type { EnginePort } from "../simport/enginePort";
import { saveText } from "../wasmhost/stepGate";
import { swapDone } from "./portLifecycle";

interface HistoryApp {
  readonly enginePort: Pick<EnginePort, "serialize" | "restore" | "undoSignature" | "generation" | "lastReason">;
  readonly ui: { toast(message: string, kind: "info"): void };
  /** The mirrored tower, whose WASM host offers its save text unparsed
   *  (#1158 A31). Goes with the mirror host in PR 5e. */
  readonly sim?: object;
}

/** The app's undo/redo history, through the engine port alone: a step is the
 *  port's save of the tower as it stood, kept in memory, and a restore is the
 *  port's `restore`, which keeps the live bridging setting and camera. The
 *  app follows the restore as it follows any swap, keeping the trail. */
export function createAppHistory(app: HistoryApp): UndoHistory {
  return new UndoHistory({
    // An undo step keeps no camera, so the hosted engine's own text serves.
    snapshot: () => (app.sim && saveText(app.sim)?.()) ?? app.enginePort.serialize(),
    restore: (text) => {
      try {
        swapDone(app.enginePort, app.enginePort.restore(text));
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    },
    signature: () => app.enginePort.undoSignature(),
    generation: () => app.enginePort.generation(),
    notify: (msg) => app.ui.toast(msg, "info"),
  });
}
