import type { Simulation } from "../Simulation";
import type { PlaceResult } from "../types";

/**
 * A shaft's capacity edits at the simulation layer (#906): the car count and
 * the span, each reporting `capacity_changed` into the gameplay events
 * (`conformance/events/catalog.json`) when the edit landed and changed
 * something. The engine-owned charges (`sim/charges.ts`) and the conformance
 * referee edit through here, as the Rust engine's `Simulation::set_cars` and
 * `Simulation::resize_transport` do. The tower's own `setCars` and
 * `resizeTransport` stay silent in both engines, for loaders and tests.
 */

export function setCars(sim: Simulation, id: number, cars: number): boolean {
  const ok = sim.tower.setCars(id, cars);
  const t = ok ? sim.tower.transportById(id) : undefined;
  if (t) sim.gameplayEvents.push("capacity_changed", { kind: t.kind });
  return ok;
}

export function resizeTransport(sim: Simulation, id: number, newBottom: number, newTop: number): PlaceResult & { added?: number; floorTilesCreated?: number } {
  const span = () => {
    const t = sim.tower.transportById(id);
    return t ? `${t.bottom}:${t.top}` : "";
  };
  const before = span();
  const r = sim.tower.resizeTransport(id, newBottom, newTop);
  const t = sim.tower.transportById(id);
  if (r.ok && t && span() !== before) sim.gameplayEvents.push("capacity_changed", { kind: t.kind });
  return r;
}
