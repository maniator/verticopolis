import { catalogFacility } from "../catalogTypes";
import { isElevatorKind } from "../facilities";
import { INVALID_REQUEST, UNKNOWN_FACILITY } from "../request";
import type { Simulation } from "../Simulation";
import type { HeatmapMode } from "../sim/constants";
import { towerCatalog } from "../towerCatalog";
import type { Unit } from "../types";
import { KIND_CODES, UNIT_STATE_CODES, VIEW_LAYOUT, codeOf, kindOf } from "./layout";
import { flag, whole, type PortState } from "./record";

/**
 * `TsEngine`'s queries: the quotes, the HUD strip, the hotspot, the
 * onboarding bits and the panel records, slot for slot what the Rust engine
 * answers (`engine-rs/src/wasm_port.rs` and `wasm_port_panels.rs`). Only the
 * quotes answer a status, so only they touch `reason`.
 */

const L = VIEW_LAYOUT;
const STATS = L.records.statsStrip as readonly (keyof ReturnType<Simulation["stats"]>)[];
const HEAT_MODES = L.heatModes as readonly HeatmapMode[];
const HEAT_TINTS = L.heatTints as readonly string[];
const VACATE_REASONS = new Map(L.vacateReasons.map((r, i) => [r, i]));
const FILM_POLICIES = new Map(L.filmPolicies.map((p, i) => [p, i]));

const nan = (n: number | null | undefined): number => n ?? NaN;

/** `[ok, cost]` for a placement, the dry run a build makes first. */
export function quoteBuild(e: PortState, kind: number, floor: number, x: number): Float64Array {
  e.reason = undefined;
  const k = kindOf(kind);
  if (!k) {
    e.reason = UNKNOWN_FACILITY;
    return Float64Array.of(0, 0);
  }
  if (!whole(floor, x)) {
    e.reason = INVALID_REQUEST;
    return Float64Array.of(0, 0);
  }
  const c = e.sim.canBuild(k, floor, x);
  if (!c.ok) e.reason = c.reason;
  return Float64Array.of(flag(c.ok), c.cost);
}

/** `[ok]` for a shaft, nothing written. */
export function quoteShaft(e: PortState, kind: number, x: number, bottom: number, top: number): Float64Array {
  e.reason = undefined;
  const k = kindOf(kind);
  if (!k) {
    e.reason = UNKNOWN_FACILITY;
    return Float64Array.of(0);
  }
  if (!whole(x, bottom, top)) {
    e.reason = INVALID_REQUEST;
    return Float64Array.of(0);
  }
  const r = e.sim.tower.validateTransport(k, x, bottom, top);
  if (!r.ok) e.reason = r.reason ?? INVALID_REQUEST;
  return Float64Array.of(flag(r.ok));
}

/** The HUD strip's counters in the layout's `statsStrip` order. */
export function statsStrip(sim: Simulation): Float64Array {
  const s = sim.stats();
  return Float64Array.from(STATS, (name) => s[name]);
}

export function hotspot(sim: Simulation): Float64Array {
  const h = sim.peakCongestionHotspot();
  return Float64Array.of(h.ratio, nan(h.floor));
}

/** The Getting Started facts as bits in the layout's `onboarding` order:
 *  lobby, floor, office, connect, play. */
export function onboarding(sim: Simulation): number {
  let lobby = false;
  let floor = false;
  let office = false;
  let connect = false;
  let play = false;
  for (const u of sim.tower.units) {
    if (u.kind === "lobby") lobby = true;
    else if (u.kind === "floor") floor ||= u.floor >= 2;
    else if (u.kind === "office") {
      office = true;
      connect ||= sim.tower.isFloorServed(u.floor);
      play ||= u.state === "occupied";
    }
  }
  return [lobby, floor, office, connect, play].reduce((bits, on, i) => (on ? bits + 2 ** i : bits), 0);
}

/** The overlay's cells as `heatCell` rows; an unknown mode answers none. */
export function heatCells(sim: Simulation, mode: number): Float64Array {
  if (!whole(mode) || mode < 0 || mode >= HEAT_MODES.length) return new Float64Array(0);
  const cells = sim.floorHeatmap(HEAT_MODES[mode]);
  const r = new Float64Array(cells.length * 5);
  cells.forEach((c, i) => {
    r.set([c.floor, c.minX, c.maxX, c.severity, c.tint === undefined ? 0 : HEAT_TINTS.indexOf(c.tint)], i * 5);
  });
  return r;
}

export function crewCoverage(sim: Simulation): Float64Array {
  const c = sim.housekeepingCoverage();
  return Float64Array.of(c.rooms, c.crews, c.maids, c.dailyCapacity, c.outOfReach, c.dirty, c.infested);
}

/** What a unit charges: 0 off the market, else its rent or its kind's
 *  default (the panels' `unitPrice`, which the engine cannot import). */
export function price(sim: Simulation, u: Unit): number {
  if (u.noRate) return 0;
  return u.rent ?? catalogFacility(towerCatalog(sim), u.kind).rent?.default ?? 0;
}

/** Unit `id`'s card in the layout's `unitCard` slots, or an empty record. */
export function unitCard(sim: Simulation, id: number): Float64Array {
  const u = whole(id) ? sim.tower.getUnit(id) : undefined;
  if (!u) return new Float64Array(0);
  return Float64Array.of(
    u.id,
    codeOf(KIND_CODES, u.kind),
    u.floor,
    u.x,
    u.width,
    codeOf(UNIT_STATE_CODES, u.state),
    u.satisfaction,
    u.occupants,
    nan(u.customersIn),
    nan(u.residents),
    flag(Boolean(u.everOccupied)),
    flag(Boolean(u.noRate)),
    nan(u.rent),
    price(sim, u),
    codeOf(VACATE_REASONS, u.vacateReason),
    codeOf(FILM_POLICIES, u.filmPolicy),
    flag(sim.tower.isFloorServed(u.floor)),
    flag(sim.floorReachable(u.floor)),
    flag(sim.tower.floorHasLobby(u.floor)),
    u.kind === "cinema" ? flag(sim.isShowingBlockbuster(u.id)) : NaN,
  );
}

/** Shaft `id`'s card: the `shaftCard` header, the 48 demand slots when
 *  `hourly` is 1, the `stopRow`s top to bottom, then the origin rings when
 *  `origins` is 1 (per weekday then weekend hour, a pair count and the
 *  (floor, count) pairs). An empty record for an id that names no shaft. */
export function shaftCard(sim: Simulation, id: number): Float64Array {
  const t = whole(id) ? sim.tower.getTransport(id) : undefined;
  if (!t) return new Float64Array(0);
  const elevator = isElevatorKind(t.kind);
  const hourly = sim.elevatorHourlyLoad(id);
  const origins = sim.elevatorOriginLoad(id);
  const stops = elevator ? t.top - t.bottom + 1 : 0;
  const r: number[] = [
    t.id,
    codeOf(KIND_CODES, t.kind),
    t.x,
    t.width,
    t.bottom,
    t.top,
    t.cars,
    sim.transportCapacity(t),
    elevator ? nan(sim.elevatorUtilization(id)) : NaN,
    flag(hourly !== undefined),
    stops,
    flag(origins !== undefined),
  ];
  if (hourly) r.push(...hourly.weekday, ...hourly.weekend);
  if (stops > 0) {
    const lobbies = new Set(sim.tower.lobbyFloors());
    for (let fl = t.top; fl >= t.bottom; fl--) {
      r.push(fl, flag(sim.tower.stopsAt(t, fl)), flag(lobbies.has(fl)), flag(fl === t.bottom || fl === t.top));
    }
  }
  if (origins) {
    for (const ring of [...origins.weekday, ...origins.weekend]) {
      r.push(ring.size);
      for (const [floor, n] of ring) r.push(floor, n);
    }
  }
  return Float64Array.from(r);
}
