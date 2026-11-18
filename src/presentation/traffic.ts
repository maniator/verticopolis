/**
 * Pure waiting line → traffic-tier mapping for the color-blind-safe traffic
 * cue in the HUD. Kept pure and headless so it's unit-testable.
 *
 * The readout follows the tower's worst waiting line right now (owner,
 * 2026-11-17): of every elevator landing where people stand waiting (the
 * engine's `queueView`, the same lines the renderer draws), the one with the
 * most pressure. It names that line's floor, and a tap zooms to that landing,
 * so what the readout says is something the player can see on screen.
 *
 * It no longer reads the floors' congestion ratio (`hotspot`): that blends a
 * transport estimate with each floor's remembered average commute wait, which
 * stays up all night when nobody is waiting, never names a basement line, and
 * cannot say which elevator was slow. That reading still drives the ratings
 * and the Map's Traffic view, and the help explains the two apart.
 *
 * This is NOT the walker-red gate either: a red walker is one person's own
 * wait, the readout is the tower's longest line of them.
 */
export type TrafficTier = 0 | 1 | 2 | 3;

/** The wait tiers a landing's line carries (`QueueLanding.tier`): the
 *  engine's worst wait among its riders. Impatient is half the stress wait,
 *  fed up the whole of it (`wait_tier`, `engine-rs/src/render_reads.rs`). */
export const LINE_WAIT = { content: 0, impatient: 1, fedUp: 2 } as const;
export type LineWaitTier = (typeof LINE_WAIT)[keyof typeof LINE_WAIT];

/** One elevator landing's waiting line, as the HUD reads it. */
export interface WaitingLine {
  readonly shaft: number;
  readonly floor: number;
  readonly count: number;
  readonly tier: LineWaitTier;
}

/** How much one person in a line counts toward its pressure, by the line's
 *  wait tier. A line nobody has waited long in is mostly a car about to come,
 *  so each of its people counts a twentieth: a car's worth reads Smooth, but a
 *  crowd of a hundred or more that has just formed reads Busy at once, and
 *  four hundred Backed up. An impatient line counts a quarter of a fed up one. */
export const LINE_WEIGHT_BY_WAIT_TIER: Readonly<Record<LineWaitTier, number>> = {
  [LINE_WAIT.content]: 0.05,
  [LINE_WAIT.impatient]: 0.25,
  [LINE_WAIT.fedUp]: 1,
};

/** A line's pressure: its riders weighted by its wait tier. */
export function linePressure(line: Pick<WaitingLine, "count" | "tier">): number {
  return line.count * LINE_WEIGHT_BY_WAIT_TIER[line.tier];
}

/** Lower edges of Busy / Backed up / Gridlock on the worst line's pressure.
 *  Backed up is about a car's worth of fed-up riders (a standard car holds
 *  21), Gridlock four cars' worth; Busy is a handful. The single source of
 *  truth: `trafficTier` maps with these, and the HUD's hysteresis
 *  (`nextTrafficTier`) reads the same array, so the two cannot desync. */
export const TRAFFIC_BOUNDS = [5, 20, 80] as const;

/** A tier holds until the pressure falls below this share of its lower edge,
 *  so a line that loses a rider or two at the edge does not flicker. */
export const TRAFFIC_HOLD = 0.75;

export function trafficTier(pressure: number): TrafficTier {
  const [busy, backedUp, gridlock] = TRAFFIC_BOUNDS;
  if (pressure >= gridlock) return 3; // Gridlock: several cars' worth of fed-up riders
  if (pressure >= backedUp) return 2; // Backed up: a car's worth of fed-up riders
  if (pressure >= busy) return 1; // Busy: a line is starting to wait too long
  return 0; // Smooth
}

/** The tier the readout shows next, from the one it shows now and the worst
 *  line's pressure: up at once, down only once the pressure is below
 *  {@link TRAFFIC_HOLD} of the shown tier's lower edge. */
export function nextTrafficTier(shown: TrafficTier, pressure: number): TrafficTier {
  const raw = trafficTier(pressure);
  if (raw >= shown) return raw;
  return pressure < TRAFFIC_BOUNDS[shown - 1] * TRAFFIC_HOLD ? raw : shown;
}

/** The landings a queue projection holds: shaft id → floor → count and tier
 *  (`ElevatorQueueView.landings`). */
export type LandingLines = ReadonlyMap<number, ReadonlyMap<number, { readonly count: number; readonly tier: LineWaitTier }>>;

/** The worst waiting line in `landings`: the most pressure, then the most
 *  people, then the lowest floor, then the first shaft listed. Null when no
 *  line has any pressure, so a line of content riders is never named. One
 *  pass over the landings. */
export function worstLine(landings: LandingLines): WaitingLine | null {
  let best: WaitingLine | null = null;
  let bestPressure = 0;
  for (const [shaft, floors] of landings) {
    for (const [floor, { count, tier }] of floors) {
      const pressure = linePressure({ count, tier });
      if (pressure <= 0) continue;
      const better =
        best === null ||
        pressure > bestPressure ||
        (pressure === bestPressure && (count > best.count || (count === best.count && floor < best.floor)));
      if (better) {
        best = { shaft, floor, count, tier };
        bestPressure = pressure;
      }
    }
  }
  return best;
}

export const TRAFFIC_LABELS = ["Smooth", "Busy", "Backed up", "Gridlock"] as const;

/** Each tier's name as the HUD's meter carries it (`data-level`), in tier
 *  order: the stylesheet fills the meter's bars from it. */
export const TRAFFIC_LEVELS = ["smooth", "busy", "backed-up", "gridlock"] as const;
export type TrafficLevel = (typeof TRAFFIC_LEVELS)[number];

export function trafficLevel(tier: TrafficTier): TrafficLevel {
  return TRAFFIC_LEVELS[tier];
}
