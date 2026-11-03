import { catalogFacility } from "../../catalog/catalogTypes";
import { isElevatorKind } from "../facilities";
import { INVALID_REQUEST, UNKNOWN_FACILITY } from "../request";
import type { Simulation } from "../Simulation";
import type { HeatmapMode } from "../sim/constants";
import { towerCatalog } from "../../catalog/towerCatalog";
import { roomUnits } from "../tower/rooms";
import type { Transport, Unit } from "../types";
import { scheduleFromSlots, scheduleSlots } from "../../simport/scheduleSlots";
import type { AutoTuneProposal, PresetProposal, ScheduleFacts } from "../../simport/enginePort";
import { coerceSchedule, type ElevatorSchedule, type HourlyByDay } from "../elevatorSchedule";
import { autoTuneSchedule, presetSchedule, recommendedPreset, scheduleAdvice, stagingSummary, type ShaftContext } from "../scheduleAuthoring";
import { dayOriginTotals, peakOriginFloor, type OriginRings } from "../scheduleOrigins";
import { BATCH_SLOTS, batchTarget } from "./commands";
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

/** What `rentBatch` would do, nothing written: `ok`, then `rentBatch`'s
 *  counters; `ok` 0 for a kind that carries no price. */
export function quoteRentBatch(e: PortState, kind: number, target: number, onlyDefault: boolean): Float64Array {
  e.reason = undefined;
  const out = new Float64Array(1 + BATCH_SLOTS.length);
  const k = kindOf(kind);
  if (!k) {
    e.reason = UNKNOWN_FACILITY;
    return out;
  }
  const t = batchTarget(target);
  if (t === undefined) {
    e.reason = INVALID_REQUEST;
    return out;
  }
  const r = e.sim.previewRentBatch(k, t, { onlyDefaultPriced: onlyDefault });
  if (!r) return out;
  out[0] = 1;
  BATCH_SLOTS.forEach((name, i) => (out[1 + i] = r[name]));
  return out;
}

/** A shaft's schedule as `scheduleShaft`'s slots; empty when it has none. */
export function shaftSchedule(e: PortState, id: number): Float64Array {
  const schedule = whole(id) ? e.sim.tower.getTransport(id)?.schedule : undefined;
  return schedule ? scheduleSlots(schedule) : new Float64Array(0);
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

/** Each Getting Started fact's flag in the `onboarding()` answer (the layout's
 *  `onboarding` order: lobby, floor, office, connect, play). */
export const ONBOARDING_FLAG = { lobby: 1, floor: 2, office: 4, connect: 8, play: 16 } as const;

/** The Getting Started facts as the flags in {@link ONBOARDING_FLAG}. */
export function onboarding(sim: Simulation): number {
  const { tower } = sim;
  // The same reads as the Rust engine's `onboarding_flags`: the lobby tile
  // counts, an early-exit scan for a floor above the lobby, and one pass over
  // the rooms that stops once the connect and play steps are both true.
  let lobby = false;
  for (const n of tower.lobbyTiles.values()) lobby ||= n > 0;
  const floor = tower.units.some((u) => u.kind === "floor" && u.floor >= 2);
  let office = false;
  let connect = false;
  let play = false;
  for (const u of roomUnits(tower)) {
    if (u.kind !== "office") continue;
    office = true;
    connect ||= tower.isFloorServed(u.floor);
    play ||= u.state === "occupied";
    if (connect && play) break;
  }
  return (
    (lobby ? ONBOARDING_FLAG.lobby : 0) +
    (floor ? ONBOARDING_FLAG.floor : 0) +
    (office ? ONBOARDING_FLAG.office : 0) +
    (connect ? ONBOARDING_FLAG.connect : 0) +
    (play ? ONBOARDING_FLAG.play : 0)
  );
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

/**
 * The TypeScript reference for `EnginePort.autoTuneProposal`: the same query
 * the Rust engine answers (`engine-rs/src/schedule_authoring.rs`), built from
 * the retiring `autoTuneSchedule` plus the warm-up gate and origin aim the
 * schedule dialog used to own. The shipped game reads Rust's answer; this is
 * the reference the real-WASM parity test compares it to, and the pure
 * {@link referenceProposal} is what the dialog's unit tests stand in for the
 * engine with.
 */

/** Sampled hours a day's curve needs before it counts as measured. */
const WARMED_MIN_HOURS = 6;

/** The shaft facts a proposal reads. `served` is ascending; `lobbies` the
 *  floors that carry a (sky) lobby. */
export interface ShaftFacts {
  modern: boolean;
  cars: number;
  bottom: number;
  top: number;
  served: readonly number[];
  lobbies: ReadonlySet<number>;
  hourly?: HourlyByDay;
  origins?: OriginRings;
  /** An express trunk (the recommended preset is Feeder). */
  express?: boolean;
}

const COLD = { warm: false, sampledHours: 0, curve: null };
const refused = (status: AutoTuneProposal["status"]): AutoTuneProposal => ({ status, weekday: COLD, weekend: COLD, proposal: null });

const day = (curve: readonly number[] | undefined) => {
  const sampledHours = curve ? curve.filter((v) => v > 0).length : 0;
  const warm = sampledHours >= WARMED_MIN_HOURS;
  return { warm, sampledHours, curve: warm ? [...curve!] : null };
};

/** The authoring-model view of a shaft: only a warm day's curve is handed over,
 *  so advice never reads a mostly-empty ring as a day of traffic. */
function shaftContext(shaft: ShaftFacts, wd: ReturnType<typeof day>, we: ReturnType<typeof day>): ShaftContext {
  return {
    cars: shaft.cars,
    bottom: shaft.bottom,
    top: shaft.top,
    servedLobbies: shaft.served.filter((f) => shaft.lobbies.has(f)),
    hourly: {
      ...(wd.warm ? { weekday: shaft.hourly!.weekday } : {}),
      ...(we.warm ? { weekend: shaft.hourly!.weekend } : {}),
    },
  };
}

/** The nearest served floor, ties to the lower one. */
function snapToServed(shaft: ShaftFacts, floor: number): number {
  let best = shaft.served[0] ?? shaft.bottom;
  let bestDist = Infinity;
  for (const f of shaft.served) {
    const d = Math.abs(f - floor);
    if (d < bestDist) { bestDist = d; best = f; }
  }
  return best;
}

/** The proposal for one shaft's facts and the working draft (already coerced
 *  to the shaft, or undefined for none). */
export function referenceProposal(shaft: ShaftFacts, draft: ElevatorSchedule | undefined, weekendView: boolean): AutoTuneProposal {
  const wd = day(shaft.hourly?.weekday);
  const we = day(shaft.hourly?.weekend);
  if (!shaft.modern) return { status: "unavailable-in-mode", weekday: wd, weekend: we, proposal: null };
  if (shaft.cars <= 0) return { status: "no-cars", weekday: wd, weekend: we, proposal: null };
  if (!wd.warm && !we.warm) return { status: "insufficient-data", weekday: wd, weekend: we, proposal: null };

  const servedSet = new Set(shaft.served);
  // The origin aim: the visible day when warm, else the other warm day.
  let peakOrigin: number | undefined;
  const useWeekend = weekendView ? we.warm || !wd.warm : we.warm && !wd.warm;
  if (shaft.origins && (useWeekend ? we.warm : wd.warm)) {
    const totals = dayOriginTotals(useWeekend ? shaft.origins.weekend : shaft.origins.weekday);
    for (const floor of [...totals.keys()]) if (!servedSet.has(floor)) totals.delete(floor);
    peakOrigin = peakOriginFloor(totals);
  }
  const ctx = shaftContext(shaft, wd, we);
  ctx.peakOriginFloor = peakOrigin;
  const homesAuthored = !!draft?.homeFloors && draft.homeFloors.length > 0;
  const tuned = autoTuneSchedule(draft ? { ...draft, homeFloors: homesAuthored ? draft.homeFloors : undefined } : undefined, ctx);

  return {
    status: "available",
    weekday: wd,
    weekend: we,
    proposal: {
      weekday: tuned?.activeCars?.weekday ?? null,
      weekend: tuned?.activeCars?.weekend ?? null,
      homeFloors: (tuned?.homeFloors ?? []).map((f) => snapToServed(shaft, f)),
      homesSeeded: !homesAuthored,
    },
  };
}

/** The elevator `id` names with its facts, or the refusal status. */
function gather(sim: Simulation, id: number): { t: Transport; shaft: ShaftFacts } | "missing-shaft" | "not-an-elevator" {
  const t = whole(id) ? sim.tower.getTransport(id) : undefined;
  if (!t) return "missing-shaft";
  if (!isElevatorKind(t.kind)) return "not-an-elevator";
  const served: number[] = [];
  for (let f = t.bottom; f <= t.top; f++) if (sim.tower.stopsAt(t, f)) served.push(f);
  return {
    t,
    shaft: {
      modern: sim.mode === "modern",
      cars: t.cars,
      bottom: t.bottom,
      top: t.top,
      served,
      lobbies: new Set(sim.tower.lobbyFloors()),
      hourly: sim.elevatorHourlyLoad(id),
      origins: sim.elevatorOriginLoad(id),
      express: t.kind === "elevatorExpress",
    },
  };
}

/** The working draft as the shaft would store it: `undefined` for none, `null`
 *  for slots that are not a schedule. */
function workingDraft(t: Transport, slots: Float64Array): ElevatorSchedule | undefined | null {
  if (slots.length === 0) return undefined;
  const parsed = scheduleFromSlots(slots);
  return parsed ? coerceSchedule(parsed, t.cars, t.bottom, t.top) : null;
}

export function autoTuneProposal(sim: Simulation, id: number, draftSlots: Float64Array, weekendView: boolean): AutoTuneProposal {
  const t = whole(id) ? sim.tower.getTransport(id) : undefined;
  if (!t) return refused("missing-shaft");
  const draft = workingDraft(t, draftSlots);
  if (draft === null) return refused("invalid-draft");
  const got = gather(sim, id);
  if (typeof got === "string") return refused(got);
  return referenceProposal(got.shaft, draft, weekendView);
}

/**
 * The TypeScript reference for `EnginePort.scheduleFacts`: the advice
 * comparison, the Simulate staging summary and the recommended preset, the
 * same facts the Rust engine answers (`engine-rs/src/schedule_facts.rs`).
 */
export function referenceFacts(shaft: ShaftFacts, draft: ElevatorSchedule | undefined, weekendView: boolean): ScheduleFacts {
  const wd = day(shaft.hourly?.weekday);
  const we = day(shaft.hourly?.weekend);
  const ctx = shaftContext(shaft, wd, we);
  const assisted = shaft.modern && shaft.cars > 0;
  const measured = (weekendView ? we : wd).warm;
  const adviceStatus = ((): ScheduleFacts["advice"]["status"] => {
    if (!shaft.modern) return "unavailable-in-mode";
    if (shaft.cars <= 0) return "no-cars";
    return measured ? "ready" : "insufficient-data";
  })();
  const adv = assisted && measured ? scheduleAdvice(draft, ctx, weekendView) : null;
  // The staging counts read the homes as the shaft would hold them (each on a
  // served floor), the same list the answer carries, so a stop edit that
  // strands a home never leaves the sentence counting the stale floor.
  const base = stagingSummary(undefined, ctx, weekendView).baseLobby;
  const homeFloors = Array.from({ length: Math.max(0, shaft.cars) }, (_, i) => {
    const home = draft?.homeFloors?.[i];
    return home === undefined ? base : snapToServed(shaft, home);
  });
  const summary = stagingSummary({ ...draft, homeFloors }, ctx, weekendView);
  return {
    status: "available",
    recommended: assisted ? recommendedPreset(!!shaft.express) : null,
    advice: {
      status: adviceStatus,
      over: adv?.over ?? [],
      short: adv?.short ?? [],
    },
    staging: { measured, ...summary },
    homeFloors,
  };
}

const FACTS_REFUSED = (status: ScheduleFacts["status"]): ScheduleFacts => ({
  status,
  recommended: null,
  advice: { status: "refused", over: [], short: [] },
  staging: null,
  homeFloors: [],
});

export function scheduleFacts(sim: Simulation, id: number, draftSlots: Float64Array, weekendView: boolean): ScheduleFacts {
  const t = whole(id) ? sim.tower.getTransport(id) : undefined;
  if (!t) return FACTS_REFUSED("missing-shaft");
  const draft = workingDraft(t, draftSlots);
  if (draft === null) return FACTS_REFUSED("invalid-draft");
  const got = gather(sim, id);
  if (typeof got === "string") return FACTS_REFUSED(got);
  return referenceFacts(got.shaft, draft, weekendView);
}

const PRESET_NAMES: ReadonlySet<string> = new Set(["rush", "balanced", "feeder", "stage-up-tower"]);

/**
 * The TypeScript reference for `EnginePort.schedulePreset`: the rows and homes
 * a named preset sets (`engine-rs/src/schedule_presets.rs`). `stage-up-tower`
 * is the Rush split staging alone, offered in both modes.
 */
export function referencePreset(shaft: ShaftFacts, name: string): PresetProposal {
  const none = (status: PresetProposal["status"]): PresetProposal => ({ status, weekday: null, weekend: null, homeFloors: [] });
  if (!PRESET_NAMES.has(name)) return none("unknown-preset");
  const stageOnly = name === "stage-up-tower";
  if (!stageOnly && !shaft.modern) return none("unavailable-in-mode");
  if (shaft.cars <= 0) return none("no-cars");
  const cold = day(undefined);
  const built = presetSchedule(stageOnly ? "rush" : (name as "rush" | "balanced" | "feeder"), shaftContext(shaft, cold, cold));
  return {
    status: "available",
    weekday: stageOnly ? null : (built.activeCars?.weekday ?? null),
    weekend: stageOnly ? null : (built.activeCars?.weekend ?? null),
    homeFloors: built.homeFloors ?? [],
  };
}

export function schedulePreset(sim: Simulation, id: number, name: string): PresetProposal {
  const got = gather(sim, id);
  if (typeof got === "string") return { status: got, weekday: null, weekend: null, homeFloors: [] };
  return referencePreset(got.shaft, name);
}
