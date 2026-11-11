import type { HourlyByDay } from "../shared/engineTypes";
import type { OriginRings } from "../shared/engineTypes";

/**
 * The hourly elevator telemetry (`elevatorUtil`, `elevatorHourly`,
 * `elevatorOrigins`) as the engine's `elevatorTelemetry()` writes it: every
 * store a list of `[shaft id, value]` pairs in insertion order, and each
 * origin slot a list of `[floor, count]` pairs. The save never carries it, so
 * a test seeds it with `seedElevatorTelemetry`.
 */
export interface TelemetryDocument {
  util: [number, number][];
  hourly: [number, HourlyByDay][];
  origins: [number, { weekday: [number, number][][]; weekend: [number, number][][] }][];
}

/** The hourly elevator stores a tower keeps, by shaft id. */
export interface TelemetryStores {
  elevatorUtil: ReadonlyMap<number, number>;
  elevatorHourly: ReadonlyMap<number, HourlyByDay>;
  elevatorOrigins: ReadonlyMap<number, OriginRings>;
}

/** A tower's telemetry in the engine's shape, as `seedElevatorTelemetry`
 *  takes it. */
export function telemetryDocument(sim: TelemetryStores): TelemetryDocument {
  const slots = (ring: Map<number, number>[]) => ring.map((slot) => [...slot]);
  return {
    util: [...sim.elevatorUtil],
    hourly: [...sim.elevatorHourly].map(([id, r]) => [id, { weekday: [...r.weekday], weekend: [...r.weekend] }]),
    origins: [...sim.elevatorOrigins].map(([id, r]) => [id, { weekday: slots(r.weekday), weekend: slots(r.weekend) }]),
  };
}
