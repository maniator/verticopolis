import { isElevatorKind } from "../../presentation/viewKinds";
import type { PersonView, TransportView } from "../../simport/view";
import { Z } from "../depthPlanes";
import { castIndex, crewIndex } from "../pixelSprites/people";
import { TILE } from "../scale";
import {
  beatFrame, figureKey, gliding, shuffling, strideFrame, waitMood, waitPose, type Glide, type StepClock,
} from "./crowdLook";

/**
 * What one routed person shows this frame (#2097): the bake, the plane it is
 * drawn on, and whether it is hidden inside a car. Pure functions of the
 * engine's state and the glide, used by the crowd pass in `towerCrowd.ts`.
 */

/** A tenant riding a car is inside it: the cab's own rider count shows them,
 *  so the figure is hidden. Staff stay visible while riding: a lone
 *  housekeeper in a 16-person service cab rounds to zero on the cab's load
 *  indicator, and watching them ride to the room floor is the whole point of
 *  the mechanic. */
export function ridingHidden(p: PersonView): boolean {
  return p.state === "riding" && !p.staff;
}

/** What this frame's figures read from the catalog and the step clock. */
export interface CrowdLook {
  readonly lit: boolean;
  readonly fedUpWait: number;
  readonly progress: number;
  readonly clock: StepClock;
}

/** The plane a person inside a revolving door is drawn on: behind the
 *  center post walking left, in front of it walking right. */
export function doorPlane(through: -1 | 1): number {
  return through === -1 ? Z.crowdBehindDoor : Z.crowd;
}

/** The plane for anyone outside a door: walkers go behind the transport. */
export function walkingPlane(p: PersonView): number {
  return p.state === "toShaft" || p.state === "toDest" ? Z.walking : Z.crowd;
}

/** The bake (`figureKey`: look, pose, frame, mood, facing) a person shows,
 *  from the engine's state: see `crowdLook.ts` for which state drives which
 *  animation. It returns the number itself, so the per-person pass allocates
 *  nothing. */
/** The middle of the elevator shaft a person waits at (#2097). The engine
 *  walks a rider to the middle of their shaft, starts the wait there, and
 *  then lines them up on one side of it, so the first waiting position is
 *  the shaft itself. A person first seen already in line (a loaded save, or
 *  a pass skipped by the zoom cull) gets the nearest elevator that stops on
 *  their floor. `null` when no elevator serves the floor. One pass over the
 *  shafts, run once per wait: the crowd pass keeps the answer until the
 *  person stops waiting. */
export function waitShaftMid(transports: ReadonlyArray<TransportView>, p: PersonView): number | null {
  let best = Infinity;
  let mid: number | null = null;
  for (const t of transports) {
    if (!isElevatorKind(t.kind) || p.floor < t.bottom || p.floor > t.top) continue;
    const m = t.x + t.width / 2;
    if (m === p.x) return m;
    const d = Math.abs(p.x - m);
    if (d < best) {
      best = d;
      mid = m;
    }
  }
  return mid;
}

/** Whether someone waiting at `x` for the shaft whose middle is `mid` faces
 *  left: they face the shaft, and keep their way while still standing in it. */
export function waitFacesLeft(x: number, mid: number | null, walkedLeft: boolean): boolean {
  if (mid === null || x === mid) return walkedLeft;
  return x > mid;
}

export function personFigure(p: PersonView, g: Glide, look: CrowdLook, through?: -1 | 1, shaftMid: number | null = null): number {
  const t = look.clock.clockMs;
  const offset = Math.abs(p.seed);
  const moving = gliding(g);
  const stride = strideFrame(look.lit, g.walked * TILE, offset);
  // Inside a revolving door, everyone leans into a wing the way they walk.
  if (through !== undefined) {
    const who = p.staff ? crewIndex(p.seed, false) : castIndex(p.seed);
    return figureKey(who, "push", stride, p.staff ? "content" : waitMood(p.wait, look.fedUpWait), through === -1, look.lit);
  }
  if (p.staff) {
    // A housekeeper dwelling at a room is cleaning it (the engine's 8-minute
    // clean); walking, it pushes its cart; riding, it stands in the car.
    if (p.state === "dwelling") return figureKey(crewIndex(p.seed, true), "push", beatFrame(t, offset), "content", g.left, look.lit);
    if (moving && p.state !== "riding") return figureKey(crewIndex(p.seed, false), "push", stride, "content", g.left, look.lit);
    return figureKey(crewIndex(p.seed, false), "stand", 1, "content", g.left, look.lit);
  }
  const who = castIndex(p.seed);
  // Long waits warm the top to amber, then the original's stress red.
  const mood = waitMood(p.wait, look.fedUpWait);
  if (p.state === "climbing") return figureKey(who, "climb", beatFrame(t, offset), mood, g.left, look.lit);
  // A waiting line closing up shuffles by a fraction of a tile: the person
  // keeps waiting, facing the shaft, rather than walking in place.
  if (p.state === "waiting" && (!moving || shuffling(g))) return figureKey(who, waitPose(p.wait, look.fedUpWait), 1, mood, waitFacesLeft(g.x, shaftMid, g.left), look.lit);
  if (moving) return figureKey(who, "walk", stride, mood, g.left, look.lit);
  return figureKey(who, "stand", 1, mood, g.left, look.lit);
}