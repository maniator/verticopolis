import type { Simulation } from "../engine/Simulation";
import { facilityFloors } from "../engine/facilities";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";
import { ViewReader } from "../simport/viewReader";
import type { UI } from "./UI";
import type { HudSource } from "./uiStatus";

/** Tests drive the HUD pump over a `Simulation` through a `TsEngine`, one
 *  engine and reader per simulation, the way the app wires them. */
const sources = new WeakMap<Simulation, { src: HudSource; reader: ViewReader }>();

function hudOf(sim: Simulation): { src: HudSource; reader: ViewReader } {
  let h = sources.get(sim);
  if (!h) {
    const port = new TsEngine(sim);
    const reader = new ViewReader(port, facilityFloors);
    h = { src: { reader, port, codes: new PortCodes(port) }, reader };
    sources.set(sim, h);
  }
  return h;
}

/** One throttled UI pass: read the frame, then `ui.update`. */
export function pump(ui: UI, sim: Simulation): void {
  const h = hudOf(sim);
  h.reader.update();
  ui.update(h.src);
}

/** Rebase the UI's log cursor on `sim`, as a tower swap does. */
export function rebaseLog(ui: UI, sim: Simulation): void {
  const h = hudOf(sim);
  h.reader.update();
  ui.resetLog(h.src);
}
