import type { Simulation } from "../engine/Simulation";
import type { WasmEngine } from "../dualrun/binding";
import type { FrameHeader } from "./frameView";
import { parseCommuteStress } from "./telemetry";
import { mergeDelta, parseDelta } from "./workerApply";

/**
 * MEASUREMENT PROTOTYPE, never merged: the coalesced main-thread host's
 * hour pass as the engine's save delta (#1068's binding) instead of a
 * full-save merge, so the PC can measure design A on that host. Reads
 * everything before any write. Returns false when the engine cannot describe
 * the change or the delta does not fit the read model; the caller then takes
 * a full merge, which primes the engine's mirror again.
 */
export function applyHourlyDelta(sim: Simulation, engine: WasmEngine, h: FrameHeader): boolean {
  const text = engine.saveDelta();
  if (text === undefined) return false;
  const housekeeping = engine.housekeepingReport() ?? null;
  const parsed = parseDelta(sim, { delta: text, telemetry: engine.elevatorTelemetry(), housekeeping });
  if (!parsed) return false;
  const commute = parseCommuteStress(engine.commuteStress());
  mergeDelta(sim, parsed, h);
  sim.crowd.adoptCommuteStress(commute);
  return true;
}
