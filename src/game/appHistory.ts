import { Simulation } from "../engine/Simulation";
import { UndoHistory, towerStateSig } from "../engine/UndoHistory";

interface HistoryApp {
  readonly sim: Simulation;
  adoptSim(sim: Simulation, preserveHistory?: boolean): void;
  readonly ui: { toast(message: string, kind: "info"): void };
}

/** The app's undo/redo history. Its ports close over `app`, so a snapshot,
 *  a signature and a restore always see the live sim across an adoptSim()
 *  swap. */
export function createAppHistory(app: HistoryApp): UndoHistory {
  const sig = (sim: Simulation) => towerStateSig(sim.tower, sim.money);
  return new UndoHistory({
    snapshot: () => JSON.stringify(app.sim.serialize()),
    restore: (snap) => app.adoptSim(Simulation.deserialize(JSON.parse(snap)), true),
    signature: () => sig(app.sim),
    // Temporary, with the WASM engine's fallback (#874).
    signatureOf: (snap) => sig(Simulation.deserialize(JSON.parse(snap))),
    notify: (msg) => app.ui.toast(msg, "info"),
  });
}
