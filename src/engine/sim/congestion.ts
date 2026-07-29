import type { Simulation } from "../Simulation";

import { FACILITIES, censusCount, facilityFloors, isElevatorKind, isStaffOnlyTransport, isHotelKind, transportCarCapacity } from "../facilities";
import type { FacilityKind } from "../types";

import { isOperational, isPresent } from "../types";

import { HeatmapMode, congestionSeverity, HeatCell } from "./constants";
import { emptyOriginRings, foldOrigins } from "../scheduleOrigins";

/** Congestion, heatmap, elevator utilization for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

/**
 * Ratio of moving population to total vertical-transport capacity. Above 1.0
 * the elevators/stairs are overcrowded and tenants get stressed. Capacity is
 * cars × per-car capacity (plus stairs/escalators), times a headroom factor
 * for the many trips made across a rush.
 */
export function congestion(sim: Simulation): number {
  if (sim.simModel === "v2") {
    // The mean of the per-floor spatial congestion (an unweighted average over
    // occupied floors), a single HUD-friendly summary of a model that is really
    // per-floor. The ground lobby (floor 1) is left OUT of this average: it now
    // carries a per-floor reading for the hotspot/max, but it is a pass-through,
    // not an occupied floor, so folding it into the mean would drag this "typical
    // populated floor" summary (and the render stress it feeds) toward the
    // always-busy lobby. The max/hotspot still surfaces a lobby jam; the mean
    // stays what it was before the lobby became reportable.
    const map = sim.spatialCongestionByFloor();
    if (map.size === 0) return 0;
    let sum = 0, n = 0;
    for (const [f, c] of map) { if (f === 1) continue; sum += c; n++; }
    return n > 0 ? sum / n : 0;
  }
  let capacity = 0;
  for (const t of sim.tower.transports) {
    // Staff-only: a service elevator carries no tenants, so it adds nothing
    // to passenger capacity (its payoff is the housekeeping staff network).
    if (isStaffOnlyTransport(t.kind)) continue;
    const per = transportCarCapacity(t.kind);
    if (isElevatorKind(t.kind)) capacity += t.cars * per;
    else capacity += per; // stairs / escalator
  }
  // Metro stations and basement parking move commuters in and out without
  // ever touching the passenger elevators, easing the crunch, the very
  // reason you build them in the original.
  for (const u of sim.tower.units) {
    // Operational only, a metro under construction / on fire moves nobody
    // (matches the v2 spatial model).
    if (u.kind === "metro" && isOperational(u)) capacity += 60;
  }
  capacity += 4 * sim.tower.functionalParkingSpots(); // only ramp-chained spaces help
  const pop = sim.tower.totalPopulation();
  if (capacity <= 0) return pop > 0 ? 3 : 0;
  // Demand swings with the day: a heavy morning/evening commute can overwhelm
  // shafts that cope fine at midday, and the tower nearly empties overnight,
  // the rush-hour rhythm the original is built around.
  return (pop * sim.rushFactor()) / (capacity * 12);
}

/** Multiplier on moving demand by time of day (rush hours vs. overnight). */
export function rushFactor(sim: Simulation): number {
  const c = sim.clock;
  if (c.isMorning() || c.isEvening()) return 1.45; // peak commute
  if (c.isLunch()) return 1.15; // lunch crowd
  if (c.isNight()) return 0.35; // tower mostly asleep
  return 0.8;
}

/** Capacity of a single transport (riders served per trip). */
export function transportCapacity(_sim: Simulation, t: { kind: FacilityKind; cars: number }): number {
  const per = transportCarCapacity(t.kind);
  return isElevatorKind(t.kind) ? t.cars * per : per;
}

/** Congestion ratio for a specific floor: per-floor in the spatial v2 model,
 * the global scalar in v1. Exposed for the inspector and tests. */
export function congestionAt(sim: Simulation, floor: number): number {
  if (sim.simModel === "v2") return sim.spatialCongestionByFloor().get(floor) ?? 0;
  return sim.congestion();
}

/** Peak per-floor congestion AND the floor it occurs on, in a single pass over
 *  the spatial map. The HUD needs both (tier from the ratio, hotspot label from
 *  the floor) every frame, so folding them into one call keeps the ~6 Hz update
 *  loop rebuilding {@link spatialCongestionByFloor} once, not twice. `floor` is
 *  `null` when nothing is congested (empty tower, all floors stranded) or in the
 *  v1 scalar model, see {@link peakCongestionFloor} for why `null`, not `0`. */
export function peakCongestionHotspot(sim: Simulation): { ratio: number; floor: number | null } {
  if (sim.simModel !== "v2") return { ratio: sim.congestion(), floor: null };
  let ratio = 0;
  let floor: number | null = null;
  // On a tie, name the LOWEST floor. A shared bottleneck (one overloaded shaft)
  // gives every floor it serves the same ratio; the lowest is closest to where
  // riders board it, so it points the player at the boarding jam (the lobby when
  // a lobby-served bank is the bottleneck) rather than an arbitrary floor in the
  // band. Deterministic, so the report never depends on transport build order.
  for (const [f, c] of sim.spatialCongestionByFloor()) {
    if (c > ratio) { ratio = c; floor = f; }
    else if (c === ratio && floor !== null && f < floor) floor = f;
  }
  return { ratio, floor };
}

/** The single busiest floor's congestion ratio (0 = clear). The overlay legend
 *  reads this to report the tower's worst pressure point in one number, so a
 *  healthy all-green map still communicates its headroom (e.g. "24% of
 *  capacity"). */
export function peakCongestion(sim: Simulation): number {
  return sim.peakCongestionHotspot().ratio;
}

/** Floor number of the busiest populated-and-served floor, the `argmax` of the
 *  per-floor congestion map that {@link peakCongestion} takes the max of, or
 *  `null` when no floor is congested (empty tower, all floors stranded, or the
 *  v1 scalar model, which has no per-floor worst floor). `null`, never `0`, is
 *  the "no floor" signal: `0` is a real floor (B1), so a sentinel of `0` would
 *  be ambiguous. The worst floor can be the ground lobby (floor 1, when a
 *  lobby-served bank is the bottleneck) or, less often, a basement commercial
 *  venue (a jammed food hall on B1/B2); the HUD therefore formats the label with
 *  the basement grammar rather than assuming an above-ground `NF`. Lets the HUD
 *  name *where* the pressure is without the engine formatting any label. */
export function peakCongestionFloor(sim: Simulation): number | null {
  return sim.peakCongestionHotspot().floor;
}

/**
 * Spatial congestion (v2, review F3): a per-floor ratio of the traveling
 * population that must pass through a floor's serving shafts to those shafts'
 * capacity. A floor's population is split across every ground-connected shaft
 * that stops there, so adding a parallel shaft genuinely relieves it, and two
 * separately-served office clusters don't pool their load the way the old
 * single tower-wide scalar did. Metro/parking drain commuters near the lobbies
 * (a global demand relief). Returns floor -> congestion ratio (>1 == stressed).
 */
export function spatialCongestionByFloor(sim: Simulation): Map<number, number> {
  return buildSpatialCongestion(sim).ratios;
}

/** Per-floor worst-shaft congestion split by transport class, the attribution
 *  behind {@link spatialCongestionByFloor}'s max. The congestion copy (#701)
 *  reads this to name the BINDING shaft's kind instead of any kind that stops
 *  at the floor. A class absent from a floor's serving set reads 0. Built by
 *  the same single pass as the ratio map, so the two can never disagree. */
export function spatialCongestionAttributionByFloor(
  sim: Simulation,
): Map<number, { elevator: number; stairs: number; escalator: number }> {
  return buildSpatialCongestion(sim).attribution;
}

function buildSpatialCongestion(sim: Simulation): {
  ratios: Map<number, number>;
  attribution: Map<number, { elevator: number; stairs: number; escalator: number }>;
} {
  const HEADROOM = 12;
  const rush = sim.rushFactor();
  const result = new Map<number, number>();
  const attribution = new Map<number, { elevator: number; stairs: number; escalator: number }>();

  const popByFloor = new Map<number, number>();
  let metro = 0;
  for (const u of sim.tower.units) {
    if (u.kind === "metro" && isOperational(u)) metro++;
    if (isPresent(u)) {
      // censusCount, not residentCount: a commercial venue stresses its floor
      // by its LIVE customers (0 when nobody is eating), never by the catalog
      // value, or every occupied fast food would fake 25 riders around the
      // clock (review P2 on the commercial census change).
      const p = censusCount(u);
      // The ground lobby (floor 1) generates no riding demand OF ITS OWN, it is
      // a pass-through, so it never seeds popByFloor. It still gets a congestion
      // reading below from the boarding pressure of the floors its shafts serve
      // (the morning-rush queue a player watches back up at the main lobby).
      if (p > 0 && u.floor !== 1) popByFloor.set(u.floor, (popByFloor.get(u.floor) ?? 0) + p);
    }
  }
  if (popByFloor.size === 0) return { ratios: result, attribution };
  const parking = sim.tower.functionalParkingSpots(); // only ramp-chained spaces relieve demand
  const relief = Math.max(0.4, 1 - metro * 0.25 - parking * 0.02);

  const served = sim.tower.servedFloorSet();
  // Ground-connected shafts and the served floors each one stops at.
  const shaftsByFloor = new Map<number, { id: number; cap: number; kind: FacilityKind }[]>();
  for (const t of sim.tower.transports) {
    // Staff-only service elevators carry no passenger load.
    if (isStaffOnlyTransport(t.kind)) continue;
    let active = false;
    for (let f = t.bottom; f <= t.top; f++) {
      if (sim.tower.stopsAt(t, f) && served.has(f)) { active = true; break; }
    }
    if (!active) continue;
    const cap = sim.transportCapacity(t);
    for (let f = t.bottom; f <= t.top; f++) {
      // Floor 1 (the ground lobby) IS recorded here: every rider on a
      // lobby-boarding shaft passes through it, so the lobby carries that
      // shaft's boarding pressure. Excluding it used to displace a lobby jam's
      // report up to the first office floor (the "backed up on 2F" the player
      // reads as off by one when the queue they see is at the main lobby, 1F).
      if (sim.tower.stopsAt(t, f) && served.has(f)) {
        const arr = shaftsByFloor.get(f) ?? [];
        arr.push({ id: t.id, cap, kind: t.kind });
        shaftsByFloor.set(f, arr);
      }
    }
  }

  // Split each floor's traveling population across the shafts that serve it,
  // **in proportion to each shaft's capacity**, riders prefer the higher-
  // throughput shaft. This is the load-balancing a real bank does, and it is
  // what makes adding ANY parallel shaft (even a weak one) strictly increase
  // total capacity and therefore REDUCE a floor's congestion. (An equal split
  // would wrongly route half the load onto a weak car and raise congestion.)
  const loadByShaft = new Map<number, number>();
  for (const [f, pop] of popByFloor) {
    const shafts = shaftsByFloor.get(f);
    if (!shafts || shafts.length === 0) continue; // unserved → handled by reachability
    const totalCap = shafts.reduce((sum, s) => sum + s.cap, 0);
    if (totalCap <= 0) continue;
    const demand = pop * relief;
    for (const s of shafts) {
      const sShare = demand * (s.cap / totalCap);
      loadByShaft.set(s.id, (loadByShaft.get(s.id) ?? 0) + sShare);
    }
  }

  // Each floor's congestion is its worst serving shaft (loads ~balanced by the split).
  for (const [f, shafts] of shaftsByFloor) {
    // The lobby (floor 1) is kept even with no residents of its own: its reading
    // is the boarding pressure of the floors its shafts serve. Every other floor
    // needs population to have a congestion signal.
    if (f !== 1 && !popByFloor.has(f)) continue;
    let c = 0;
    const att = { elevator: 0, stairs: 0, escalator: 0 };
    for (const s of shafts) {
      const cong = s.cap > 0 ? ((loadByShaft.get(s.id) ?? 0) * rush) / (s.cap * HEADROOM) : 99;
      if (cong > c) c = cong;
      // Fold the same reading into its class max: the ratio map's max over
      // shafts equals the max over these three class maxes by construction.
      if (isElevatorKind(s.kind)) { if (cong > att.elevator) att.elevator = cong; }
      else if (s.kind === "stairs") { if (cong > att.stairs) att.stairs = cong; }
      else if (s.kind === "escalator") { if (cong > att.escalator) att.escalator = cong; }
    }
    result.set(f, c);
    attribution.set(f, att);
  }
  return { ratios: result, attribution };
}

/**
 * Colored-overlay cells, severity (0 = good/green … 1 = bad/red) plus the
 * column extent each tint covers, for the stats overlay (the original's
 * evaluation maps). NOT a 1:1 floor mapping: `congestion`/`occupancy` emit one
 * cell per floor (spanning its built extent), while `satisfaction` emits one
 * cell per present tenant unit (spanning that unit's footprint), so a floor can
 * carry several satisfaction cells. Only cells with data for the chosen mode
 * are returned. Scans the unit list once; the renderer caches it (hourly), so
 * it's off the per-frame path.
 *
 * - `congestion`: how jammed the floor's transport is (per-floor congestion).
 * - `occupancy`:  the floor's vacant share (red = empty, green = fully leased).
 * - `satisfaction`: per-unit tenant unhappiness (red = a tenant near leaving).
 * - `cleanliness`: per-hotel-room housekeeping coverage (red = no service-elevator
 *   crew can reach it, amber = dirty and waiting, green = clean and covered),
 *   plus two out-of-ramp categories via {@link HeatCell.tint}: `infested`
 *   (terminal, cleaning can't fix it, rendered distinctly from unreached) and
 *   `na` on condos (they never take housekeeping, so a blank can't be misread
 *   as an uncovered room).
 */
export function floorHeatmap(sim: Simulation, mode: HeatmapMode): HeatCell[] {
  if (mode === "cleanliness") {
    // Per hotel room, the units housekeeping serves: tint by whether a crew can
    // reach it and whether it is dirty right now. Staff travel the service
    // network (service elevators, stairs), never passenger
    // elevators, so a room with no operational housekeeping crew in its staff
    // component can never be cleaned: that is the worst case (red), the
    // "build another housekeeping station or extend the service elevator" nudge
    // given a place to point. A reachable but dirty room is amber (it is waiting
    // its turn), and a reachable clean room is green. Hotel rooms carry the
    // coverage signal; condos get an explicit n/a tint (below) and every
    // other kind stays untinted.
    // Precompute crew reach once, so the per-room test is O(1) instead of
    // O(rooms x crews). A room is reachable iff some operational crew is on its
    // floor, or shares its staff-network component. `staffConnected(a, b)` is
    // exactly "a === b, or both floors carry the same component id", so collect
    // the crew floors and the component ids those floors belong to, then a room
    // matches on either. The component map is revision-memoized (routing.ts).
    const comps = sim.tower.staffComponents();
    const crewFloors = new Set<number>();
    const crewComps = new Set<number>();
    for (const u of sim.tower.units) {
      if (u.kind !== "housekeeping" || !isOperational(u)) continue;
      crewFloors.add(u.floor);
      const c = comps.get(u.floor);
      if (c !== undefined) crewComps.add(c);
    }
    const out: HeatCell[] = [];
    for (const u of sim.tower.units) {
      // Condos never need housekeeping, but on this map a blank condo reads
      // exactly like an uncovered hotel room, so give it an explicit neutral
      // "not applicable" cell instead of nothing (overhaul GDD, legibility).
      if (u.kind === "condo" && isOperational(u)) {
        out.push({ floor: u.floor, minX: u.x, maxX: u.x + u.width - 1, severity: 0, tint: "na" });
        continue;
      }
      // Only live hotel rooms carry a housekeeping signal: a room still under
      // construction, ablaze, or a burned-out shell has no coverage state to
      // report, so skip it (matching the satisfaction/occupancy branches, which
      // likewise ignore units with nothing to say).
      if (!isHotelKind(u.kind) || !isOperational(u)) continue;
      // A full cockroach infestation is TERMINAL, not a coverage failure:
      // housekeeping can never clean it whatever the network looks like, so it
      // carries its own semantic tint, distinct from the red "no crew can
      // reach this" end of the ramp ("reached but terminal" must never read
      // as "no coverage"). Severity still reads hot for anything consuming
      // the number alone.
      if (u.state === "infested") {
        out.push({ floor: u.floor, minX: u.x, maxX: u.x + u.width - 1, severity: 0.85, tint: "infested" });
        continue;
      }
      const roomComp = comps.get(u.floor);
      const reachable = crewFloors.has(u.floor) || (roomComp !== undefined && crewComps.has(roomComp));
      // Unreachable is the worst (red): no crew can ever service it. A
      // reachable dirty room is amber (waiting its turn), a clean covered
      // room green.
      const severity = !reachable ? 1 : u.state === "dirty" ? 0.6 : 0;
      out.push({ floor: u.floor, minX: u.x, maxX: u.x + u.width - 1, severity });
    }
    return out;
  }

  if (mode === "satisfaction") {
    // Per-unit, not per-floor: tint each present tenant's own footprint by its
    // unhappiness. Averaging a floor would let one miserable suite (near
    // leaving) vanish behind content neighbors, exactly the tenant the player
    // opened this overlay to find, so each unit reddens on its own. Only
    // judge units with someone actually present right now (an empty suite has
    // no happiness signal; its vacancy is the occupancy map's job).
    const out: HeatCell[] = [];
    for (const u of sim.tower.units) {
      const rentable = FACILITIES[u.kind].population > 0 || isHotelKind(u.kind);
      if (!rentable || !isPresent(u)) continue;
      out.push({ floor: u.floor, minX: u.x, maxX: u.x + u.width - 1, severity: 1 - u.satisfaction });
    }
    return out;
  }

  const ext = new Map<number, { min: number; max: number }>();
  // Per-floor tenancy accumulator for occupancy. `present` is the live-tenant
  // count (offices/condos read present whenever leased, hotels only while a
  // guest is in); occupancy grades vacancy against it.
  const acc = new Map<number, { total: number; present: number }>();
  for (const u of sim.tower.units) {
    const right = u.x + u.width - 1;
    for (let fl = u.floor; fl < u.floor + facilityFloors(u.kind); fl++) {
      const e = ext.get(fl);
      if (!e) ext.set(fl, { min: u.x, max: right });
      else {
        if (u.x < e.min) e.min = u.x;
        if (right > e.max) e.max = right;
      }
    }
    if (mode === "occupancy") {
      const rentable = FACILITIES[u.kind].population > 0 || isHotelKind(u.kind);
      if (rentable) {
        const a = acc.get(u.floor) ?? { total: 0, present: 0 };
        a.total++;
        if (isPresent(u)) a.present++;
        acc.set(u.floor, a);
      }
    }
  }
  // Build the congestion source ONCE, not per floor. congestionAt(floor) in v2
  // rebuilds the whole spatial map on every call, so reading it inside the loop
  // below would be O(F²) map builds per refresh; the v1 scalar is likewise
  // read once. (Off the frame path, the renderer caches this hourly, but the
  // quadratic build is still needless.)
  const congMap = mode === "congestion" && sim.simModel === "v2" ? sim.spatialCongestionByFloor() : null;
  const congScalar = mode === "congestion" && sim.simModel !== "v2" ? sim.congestion() : 0;

  const out: HeatCell[] = [];
  for (const [floor, e] of ext) {
    let severity: number;
    if (mode === "congestion") {
      // Sim-anchored ramp: amber at the churn threshold, red at gridlock, with
      // the sub-churn band spread out so a healthy tower's busiest floors are
      // still legible instead of a flat green wash (see congestionSeverity).
      severity = congestionSeverity(congMap ? (congMap.get(floor) ?? 0) : congScalar);
    } else {
      const a = acc.get(floor);
      if (!a || a.total === 0) continue; // no tenancy here → don't tint
      severity = 1 - a.present / a.total; // vacant share
    }
    out.push({ floor, minX: e.min, maxX: e.max, severity });
  }
  return out;
}

/** Fold this hour's car occupancy into each passenger elevator's running
 *  utilization average, and forget shafts that have been removed. */
export function sampleElevatorUtil(sim: Simulation): void {
  const aliveUtil = new Set<number>();
  const aliveHourly = new Set<number>();
  const hour = ((Math.floor(sim.clock.hour) % 24) + 24) % 24;
  const day = sim.clock.isWeekend ? "weekend" : "weekday";
  // The dispatcher's boarding tally since the last hourly sample: the feed for
  // the per-floor origin rings (#465). Drained exactly once per sample. Unlike
  // the demand ring's frac (an instantaneous snapshot), the tally covers the
  // hour that just ENDED, so it attributes to the previous hour and to THAT
  // hour's day type (at 00:00 that is yesterday's 23:00, which flips the day
  // ring at every weekday/weekend boundary).
  const boardings = sim.elevators.drainBoardings();
  const prevMinutes = sim.clock.minutes - 60;
  const originHour = ((Math.floor(prevMinutes / 60) % 24) + 24) % 24;
  const cal = sim.clock.calendar;
  const prevDow = Math.max(0, Math.floor(prevMinutes / 1440)) % cal.weekDays;
  const originWeekend = prevDow >= cal.weekDays - cal.weekendDays;
  for (const t of sim.tower.transports) {
    if (!isElevatorKind(t.kind)) continue;
    const cap = t.cars * transportCarCapacity(t.kind);
    const load = (t.carLoad ?? []).reduce((sum, n) => sum + n, 0);
    const frac = cap > 0 ? Math.min(1, load / cap) : 0;
    // Per-shaft demand-by-hour curves (elevator-scheduling #305): EMA this hour's
    // load into slot [hour] of the CURRENT DAY TYPE's transient 24-ring (#466), so
    // the dialog's ghost, advice, and Auto-tune read a day-true curve and an
    // office tower dead on weekends is never steered toward a phantom weekend
    // rush. All elevator kinds (service and express included) are recorded, since
    // all three are schedulable, unlike the passenger-only utilization EMA below.
    aliveHourly.add(t.id);
    let rings = sim.elevatorHourly.get(t.id);
    // Shape self-heal (kept from the single-ring version): a malformed entry is
    // replaced, never EMA'd into or crashed on.
    if (!rings || rings.weekday?.length !== 24 || rings.weekend?.length !== 24) {
      rings = { weekday: new Array(24).fill(0), weekend: new Array(24).fill(0) };
      sim.elevatorHourly.set(t.id, rings);
    }
    const ring = rings[day];
    // First real sample lands at full value (same seeding rule as the util EMA
    // below): a zero slot usually means "not yet sampled", and blending the first
    // sample toward that zero would under-report the hour for days. A genuinely
    // zero-load hour also reads 0 (the slot is only written when frac > 0), so a
    // dead day can never warm; that conflation is tracked as #474.
    ring[hour] = ring[hour] === 0 && frac > 0 ? frac : 0.3 * frac + 0.7 * ring[hour];
    // Origin rings (#465): fold the ended hour's boardings-by-floor with the
    // same day-split and EMA rules, attributed to the hour they happened in.
    let origins = sim.elevatorOrigins.get(t.id);
    if (!origins) sim.elevatorOrigins.set(t.id, (origins = emptyOriginRings()));
    foldOrigins(origins, originWeekend, originHour, boardings.get(t.id));
    // Passenger utilization EMA (staff-only shafts excluded, as before).
    if (isStaffOnlyTransport(t.kind)) continue;
    aliveUtil.add(t.id);
    const prev = sim.elevatorUtil.get(t.id);
    // Slow EMA so the figure reflects a typical day, not the current instant.
    sim.elevatorUtil.set(t.id, prev === undefined ? frac : 0.15 * frac + 0.85 * prev);
  }
  for (const id of [...sim.elevatorUtil.keys()]) if (!aliveUtil.has(id)) sim.elevatorUtil.delete(id);
  for (const id of [...sim.elevatorHourly.keys()]) if (!aliveHourly.has(id)) sim.elevatorHourly.delete(id);
  for (const id of [...sim.elevatorOrigins.keys()]) if (!aliveHourly.has(id)) sim.elevatorOrigins.delete(id);
}

/** Average utilization (0..1) of a passenger elevator, or undefined for a
 *  non-passenger transport or one not yet sampled. */
export function elevatorUtilization(sim: Simulation, id: number): number | undefined {
  return sim.elevatorUtil.get(id);
}

/** Per-passenger-elevator utilization report for the stats screen, busiest
 *  first: each shaft's served range, car count, capacity/trip and average
 *  fullness. Excludes staff-only service elevators (no passenger load). */
export function elevatorStats(sim: Simulation): { id: number; kind: FacilityKind; bottom: number; top: number; cars: number; capacity: number; utilization: number }[] {
  const out = [];
  for (const t of sim.tower.transports) {
    if (!isElevatorKind(t.kind) || isStaffOnlyTransport(t.kind)) continue;
    out.push({
      id: t.id,
      kind: t.kind,
      bottom: t.bottom,
      top: t.top,
      cars: t.cars,
      capacity: t.cars * transportCarCapacity(t.kind),
      utilization: sim.elevatorUtil.get(t.id) ?? 0,
    });
  }
  return out.sort((a, b) => b.utilization - a.utilization);
}

/**
 * 0..1 frustration from the {@link Crowd}: the fraction of real people stuck
 * waiting too long for an elevator. Supplements the aggregate
 * {@link congestion} signal with what's actually happening to the commuters.
 */
export function crowdStress(sim: Simulation): number {
  return sim.crowd.stress;
}
