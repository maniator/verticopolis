import { UndoHistory } from "../engine/UndoHistory";
import type { SimPort } from "../simport/port";

interface HistoryApp {
  readonly port: SimPort;
  readonly ui: { toast(message: string, kind: "info"): void };
}

/** The app's undo/redo history, through the port alone: a step is the
 *  port's save of the tower as it stood, kept in memory, and a restore is a
 *  `history` load, which keeps the camera, the trail and the bridging
 *  setting. The port follows every adoptSim() swap. */
export function createAppHistory(app: HistoryApp): UndoHistory {
  return new UndoHistory({
    snapshot: () => app.port.saveNow({ memory: true }),
    restore: (text) => app.port.load({ from: "history", text }),
    signature: () => app.port.undoSignature(),
    notify: (msg) => app.ui.toast(msg, "info"),
  });
}
