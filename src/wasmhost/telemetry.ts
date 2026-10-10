import type { Simulation } from "../engine/Simulation";
import type { HourlyByDay } from "../engine/elevatorSchedule";
import type { OriginRings } from "../engine/scheduleOrigins";

/**
 * The hourly elevator telemetry (`elevatorUtil`, `elevatorHourly`,
 * `elevatorOrigins`) as the engine's `elevatorTelemetry()` writes it: every
 * store a list of `[shaft id, value]` pairs in insertion order, and each
 * origin slot a list of `[floor, count]` pairs. The save never carries it, so
 * the WASM host reads it from the engine at every merge.
 */
export interface TelemetryDocument {
  util: [number, number][];
  hourly: [number, HourlyByDay][];
  origins: [number, { weekday: [number, number][][]; weekend: [number, number][][] }][];
}

/** The instance's telemetry in the engine's shape. */
export function telemetryDocument(sim: Simulation): TelemetryDocument {
  const slots = (ring: Map<number, number>[]) => ring.map((slot) => [...slot]);
  return {
    util: [...sim.elevatorUtil],
    hourly: [...sim.elevatorHourly].map(([id, r]) => [id, { weekday: [...r.weekday], weekend: [...r.weekend] }]),
    origins: [...sim.elevatorOrigins].map(([id, r]) => [id, { weekday: slots(r.weekday), weekend: slots(r.weekend) }]),
  };
}

/** Make the instance's telemetry the document's, in place: the stores, each
 *  shaft's day rings and each origin slot keep their identity and take the new
 *  values, as the TypeScript engine's hourly sample updates them. The schedule
 *  dialog holds a shaft's rings while it is open and recomputes from them
 *  (uiElevatorSchedule.ts), so fresh objects would freeze it on the curve it
 *  opened with. Shafts the document lacks are dropped. */
export function adoptTelemetry(sim: Simulation, doc: TelemetryDocument): void {
  const fill = (target: number[], from: number[]) => {
    target.length = from.length;
    for (let i = 0; i < from.length; i++) target[i] = from[i];
  };
  const refill = (slots: Map<number, number>[], from: [number, number][][]) => {
    slots.length = from.length;
    for (let h = 0; h < from.length; h++) {
      const slot = slots[h] ?? (slots[h] = new Map());
      slot.clear();
      for (const [floor, n] of from[h]) slot.set(floor, n);
    }
  };
  const keepOnly = <V>(store: Map<number, V>, ids: number[]) => {
    const live = new Set(ids);
    for (const id of [...store.keys()]) if (!live.has(id)) store.delete(id);
  };

  keepOnly(sim.elevatorUtil, doc.util.map(([id]) => id));
  for (const [id, v] of doc.util) sim.elevatorUtil.set(id, v);

  keepOnly(sim.elevatorHourly, doc.hourly.map(([id]) => id));
  for (const [id, r] of doc.hourly) {
    const held = sim.elevatorHourly.get(id);
    if (held) {
      fill(held.weekday, r.weekday);
      fill(held.weekend, r.weekend);
    } else {
      sim.elevatorHourly.set(id, { weekday: [...r.weekday], weekend: [...r.weekend] });
    }
  }

  keepOnly(sim.elevatorOrigins, doc.origins.map(([id]) => id));
  for (const [id, r] of doc.origins) {
    const held = sim.elevatorOrigins.get(id);
    if (held) {
      refill(held.weekday, r.weekday);
      refill(held.weekend, r.weekend);
    } else {
      const o: OriginRings = { weekday: [], weekend: [] };
      refill(o.weekday, r.weekday);
      refill(o.weekend, r.weekend);
      sim.elevatorOrigins.set(id, o);
    }
  }
}
