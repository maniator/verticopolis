import type { Tower } from "../Tower";
import type { PlaceResult } from "../types";
import * as transport from "./transport";

/**
 * The host's capacity edits on a shaft (the editor's car count and its
 * extend arrows), reporting `capacity_changed` into the owning simulation's
 * gameplay events (`conformance/events/catalog.json`) when the edit landed
 * and changed something. A bare tower has no buffer and reports nothing.
 * The Rust engine reports from `Simulation::set_cars` and
 * `Simulation::resize_transport`, which its binding and referee call.
 */

export function setCars(tower: Tower, id: number, cars: number): boolean {
  const ok = transport.setCars(tower, id, cars);
  const t = ok ? tower.transportById(id) : undefined;
  if (t) tower.gameplayEvents?.push("capacity_changed", { kind: t.kind });
  return ok;
}

export function resizeTransport(tower: Tower, id: number, newBottom: number, newTop: number): PlaceResult & { added?: number; floorTilesCreated?: number } {
  const span = () => {
    const t = tower.transportById(id);
    return t ? `${t.bottom}:${t.top}` : "";
  };
  const before = span();
  const r = transport.resizeTransport(tower, id, newBottom, newTop);
  const t = tower.transportById(id);
  if (r.ok && t && span() !== before) tower.gameplayEvents?.push("capacity_changed", { kind: t.kind });
  return r;
}
