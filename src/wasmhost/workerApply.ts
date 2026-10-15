import { Simulation } from "../engine/Simulation";
import type { FrameHeader } from "./frameView";
import { mergeSimulation } from "./merge";
import { adoptTelemetry, isTelemetryDocument, type TelemetryDocument } from "./telemetry";
import type { MergePayload } from "./workerProtocol";

/**
 * The worker host's read-model writes, apart from its message handling:
 * the full-save merge and the header fields a fresh reply carries.
 */

/** A merge payload, read in full before any write: a payload that does not
 *  parse throws here, with the read model untouched. */
export interface ParsedMerge {
  fresh: Simulation;
  telemetry: TelemetryDocument;
  housekeeping: { cleaned: number; leftover: number } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseMerge(m: MergePayload): ParsedMerge {
  const save = JSON.parse(m.save) as unknown;
  // The load path repairs a bad save to defaults; a merge must fail instead.
  if (!isRecord(save) || !Array.isArray(save.units) || !Array.isArray(save.transports) || typeof save.minutes !== "number") throw new Error("merge: the save is not the engine's shape");
  const fresh = Simulation.deserialize(save as unknown as Parameters<typeof Simulation.deserialize>[0]);
  const telemetry = JSON.parse(m.telemetry) as unknown;
  if (!isTelemetryDocument(telemetry)) throw new Error("merge: the telemetry is not the engine's shape");
  const housekeeping = m.housekeeping ? (JSON.parse(m.housekeeping) as { cleaned: number; leftover: number }) : null;
  if (housekeeping && (typeof housekeeping.cleaned !== "number" || typeof housekeeping.leftover !== "number")) throw new Error("merge: the housekeeping report is not the engine's shape");
  return { fresh, telemetry, housekeeping };
}

/** A JSON array from a reply whose every item passes `isItem`, or an error
 *  naming the part. */
export function parseArray<T>(text: string, what: string, isItem: (v: unknown) => boolean): T[] {
  const v = JSON.parse(text) as unknown;
  if (!Array.isArray(v)) throw new Error(`reply: the ${what} is not a list`);
  if (!v.every(isItem)) throw new Error(`reply: an item in the ${what} is not the engine's shape`);
  return v as T[];
}

/** A gameplay event as the engine sends it: a name and a payload object. */
export const isEventItem = (v: unknown): boolean => isRecord(v) && typeof v.name === "string" && isRecord(v.payload);

/** A log entry as the engine sends it. */
export const isLogItem = (v: unknown): boolean => isRecord(v) && typeof v.minute === "number" && typeof v.text === "string" && typeof v.kind === "string";

/** The pending choice a reply carries when its header says one is open. */
export function parsePending<T>(text: string): T {
  const v = JSON.parse(text) as unknown;
  if (!isRecord(v)) throw new Error("reply: the pending choice is not the engine's shape");
  return v as T;
}

/** The engine's dropped-event count. */
export function parseCount(n: unknown, what: string): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new Error(`reply: the ${what} is not a count`);
  return n;
}

/** Merge the engine's full save into the read model, keeping the
 *  instance's clock (the frame loop's, which already counts the steps still
 *  in flight), its own event buffer and the camera view, and adopt the hourly telemetry and
 *  the housekeeping result the save leaves out. */
export function mergeSave(sim: Simulation, m: ParsedMerge, h: FrameHeader): void {
  const buffer = sim.gameplayEvents;
  const minutes = sim.clock.minutes;
  // The camera is the page's: a save sent before the last stamp carries an
  // older view, which must not replace the one the page set.
  const view = sim.view;
  try {
    mergeSimulation(sim, m.fresh, { revision: h.revision, mealOverlayRevision: sim.tower.mealOverlayRevision });
  } finally {
    sim.gameplayEvents = buffer;
    sim.clock.minutes = minutes;
    sim.view = view;
  }
  adoptTelemetry(sim, m.telemetry);
  sim.economy.adoptHousekeepingReport(m.housekeeping);
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
