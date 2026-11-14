/**
 * Where a person on a stairway or escalator is drawn. The engine keeps a
 * climber at the flight's middle and moves only their floor, which drew them
 * rising straight up the middle of the flight. A flight is drawn as a run from
 * a lower landing on one side to an upper landing on the other
 * (`sprites/transport.ts`), so a climber is drawn along that run instead: the
 * engine's floor still says how far up they are, and this only says where
 * along the run that height falls. Nothing here changes the simulation.
 */
import type { TransportView } from "../simport/view";
import { TILE } from "./scale";
import { halfTurnY } from "./sprites/escalator";
import { spiralAngle, spiralRadius } from "./sprites/spiralStair";
import { FLOOR } from "./scale";

/** The run's lower landing, in pixels from the flight's left edge. Matches
 *  `x0` in `drawStairFlight` and `drawEscalatorRun`. */
export const RUN_FOOT_PX = 10;
/** The run's upper landing, in pixels from the flight's right edge. Matches
 *  `x1` in `drawStairFlight` and `drawEscalatorRun`. */
export const RUN_HEAD_PX = 12;

export interface ClimbSpot {
  /** Drawn x, tiles. */
  x: number;
  /** Whether the climb moves left to right here on the way up. */
  rightward: boolean;
}

/** The share of a story the lower run of a half-turn escalator climbs
 *  (`sprites/escalator.ts`): the landing sits at `halfTurnY` of a story band. */
const HALF_TURN_LOWER = 1 - halfTurnY(0, FLOOR) / FLOOR;

/** Writes into `out` the point along `t`'s run at floor `fy`. Out of a tall
 *  lobby an escalator turns back each story (the switchback), so odd stories
 *  above the bottom run right to left, and a stairway winds around its newel
 *  pole (`sprites/spiralStair.ts`), so its climber follows that helix. A
 *  one-story flight that `winds` beside a venue (`venueFlights.ts`) is a
 *  one-story spiral, or an escalator that turns back at its landing. */
function placeOnFlight(t: Pick<TransportView, "kind" | "x" | "width" | "bottom" | "top">, fy: number, out: ClimbSpot, winds = false): ClimbSpot {
  const span = Math.max(t.top - t.bottom, 0);
  const rise = Math.min(Math.max(fy - t.bottom, 0), span);
  const windsHere = winds && span === 1;
  if (t.kind === "stairs" && (span > 1 || windsHere)) {
    const a = spiralAngle(rise / span, span);
    out.x = t.x + t.width / 2 + (spiralRadius(t.width * TILE) * Math.sin(a)) / TILE;
    out.rightward = Math.cos(a) >= 0;
    return out;
  }
  const foot = t.x + RUN_FOOT_PX / TILE;
  const head = t.x + t.width - RUN_HEAD_PX / TILE;
  if (t.kind === "escalator" && windsHere) {
    const upper = rise > HALF_TURN_LOWER;
    const along = upper ? (rise - HALF_TURN_LOWER) / (1 - HALF_TURN_LOWER) : rise / HALF_TURN_LOWER;
    out.rightward = !upper;
    out.x = upper ? head - (head - foot) * along : foot + (head - foot) * along;
    return out;
  }
  const story = Math.min(Math.floor(rise), Math.max(span - 1, 0));
  const along = Math.min(Math.max(rise - story, 0), 1);
  out.rightward = story % 2 === 0;
  out.x = out.rightward ? foot + (head - foot) * along : head - (head - foot) * along;
  return out;
}

/** The point along `t`'s run at floor `fy`; `winds` when it stands beside a
 *  venue (`venueFlights.ts`). */
export function climbSpot(t: Pick<TransportView, "kind" | "x" | "width" | "bottom" | "top">, fy: number, winds = false): ClimbSpot {
  return placeOnFlight(t, fy, { x: 0, rightward: true }, winds);
}

/** The stairway or escalator a climber at `x` on `floor` is on: the one
 *  whose middle they stand at. */
export function climbFlight(transports: ReadonlyArray<TransportView>, x: number, floor: number): TransportView | undefined {
  for (const t of transports) {
    if (t.kind !== "stairs" && t.kind !== "escalator") continue;
    if (floor < t.bottom || floor > t.top) continue;
    if (Math.abs(t.x + t.width / 2 - x) < 1e-6) return t;
  }
  return undefined;
}

/** Reused by `climbDrawX` so a frame allocates nothing. */
const SCRATCH: ClimbSpot = { x: 0, rightward: true };

/** What a drawn person remembers about the flight they climb. */
export interface Climber {
  /** The flight found when the climb began; `null` when none matched. */
  flight?: TransportView | null;
  /** Where the climber was last drawn, so the walk off the flight starts
   *  from that landing instead of the flight's middle. */
  climbX?: number;
  /** Whether the climber faces left this frame. */
  climbLeft?: boolean;
  /** Whether the flight winds beside a venue, read when the climb began. */
  flightWinds?: boolean;
}

/** The drawn x of a climber this frame, or `undefined` when no flight
 *  matches (the engine's x stands). Sets `climbLeft` to face the way they go
 *  along the run. `fy` is their drawn floor, `descending` whether they are on
 *  their way down, `winding` the ids of the flights that wind beside a venue
 *  (`venueFlights.ts`), read once when the climb begins. Runs per climber per
 *  frame, so it allocates nothing once the flight is found. */
export function climbDrawX(
  c: Climber,
  transports: ReadonlyArray<TransportView>,
  x: number,
  floor: number,
  fy: number,
  descending: boolean,
  winding?: ReadonlySet<number>,
): number | undefined {
  if (c.flight === undefined) {
    c.flight = climbFlight(transports, x, floor) ?? null;
    c.flightWinds = c.flight !== null && winding !== undefined && winding.has(c.flight.id);
  }
  if (!c.flight) return undefined;
  const spot = placeOnFlight(c.flight, fy, SCRATCH, c.flightWinds === true);
  c.climbX = spot.x;
  c.climbLeft = spot.rightward === descending;
  return c.climbX;
}

/** Hand a finished climb's landing to the walk that follows it: returns the
 *  x the walk should start from, or `undefined` when there was no climb. */
export function leaveFlight(c: Climber): number | undefined {
  const at = c.climbX;
  c.flight = undefined;
  c.climbX = undefined;
  c.climbLeft = undefined;
  c.flightWinds = undefined;
  return at;
}
