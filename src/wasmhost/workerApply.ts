import { Simulation } from "../engine/Simulation";
import type { FrameHeader } from "./frameView";
import { mergeSimulation } from "./merge";
import { adoptTelemetry, type TelemetryDocument } from "./telemetry";
import type { MergePayload } from "./workerProtocol";

/**
 * The worker host's read-model writes, apart from its message handling:
 * the full-save merge and the header fields a fresh reply carries.
 */

/** Merge the engine's full save into the read model, keeping the
 *  instance's clock (the frame loop's, which already counts the steps still
 *  in flight), its own event buffer and the camera view, and adopt the hourly telemetry and
 *  the housekeeping result the save leaves out. */
export function mergeSave(sim: Simulation, m: MergePayload, h: FrameHeader): void {
  const fresh = Simulation.deserialize(JSON.parse(m.save));
  const buffer = sim.gameplayEvents;
  const minutes = sim.clock.minutes;
  // The camera is the page's: a save sent before the last stamp carries an
  // older view, which must not replace the one the page set.
  const view = sim.view;
  try {
    mergeSimulation(sim, fresh, { revision: h.revision, mealOverlayRevision: sim.tower.mealOverlayRevision });
  } finally {
    sim.gameplayEvents = buffer;
    sim.clock.minutes = minutes;
    sim.view = view;
  }
  adoptTelemetry(sim, JSON.parse(m.telemetry) as TelemetryDocument);
  sim.economy.adoptHousekeepingReport(m.housekeeping ? (JSON.parse(m.housekeeping) as { cleaned: number; leftover: number }) : null);
}

/** The header fields a fresh reply sets, as the main-thread host sets them. */
export function applyHeaderFields(sim: Simulation, h: FrameHeader): void {
  sim.money = h.money;
  sim.star = h.star;
  sim.weather = h.weather;
  sim.onHourRuns = h.onHourRuns;
  sim.santaFxSeq = h.santaFxSeq;
  if (sim.explosionFx.seq !== h.explosionFx.seq) sim.explosionFx = { floor: h.explosionFx.floor, x: h.explosionFx.x, seq: h.explosionFx.seq };
  if (sim.thiefFx.seq !== h.thiefFx.seq) sim.thiefFx = { caught: h.thiefFx.caught, floor: h.thiefFx.floor, seq: h.thiefFx.seq };
  if (sim.treasureFx.seq !== h.treasureFx.seq) sim.treasureFx = { floor: h.treasureFx.floor, x: h.treasureFx.x, seq: h.treasureFx.seq };
  sim.vipFxSeq = h.vipFxSeq;
  sim.events.adoptCounts(h.counts);
}

/** A copy of a camera view, so a later change to the caller's object does
 *  not reach the save it was stamped into. */
export const structuredCloneOf = <T>(v: T): T => (v == null ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Put back an own property the host replaced: the one that was there, or
 *  none (the prototype's member shows through again). */
export function restoreOwn(sim: Simulation, name: string, desc: PropertyDescriptor | undefined): void {
  if (desc) Object.defineProperty(sim, name, desc);
  else delete (sim as unknown as Record<string, unknown>)[name];
}
