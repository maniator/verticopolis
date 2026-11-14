import { LOOKS, walkFrame, type Mood, type Pose } from "../pixelSprites/people";
import { SNAP_FLOORS as CAR_SNAP_FLOORS } from "../carMotion";

/**
 * What a moving figure shows this frame (#2097), as pure functions of the
 * engine's own state, so every animation comes from the game and none is a
 * loop for its own sake:
 *
 * - the waiting poses come from how long the person has waited (`wait`)
 *   against the engine's fed-up line (`rules.fedUpWait`): checking the time,
 *   then hands on hips in the impatient amber, then arms up in the stress red;
 * - the walk cycle follows the distance the drawn figure walks between two
 *   real positions, so it stops when the figure reaches the engine's one;
 * - a housekeeper `dwelling` at a room is cleaning it, so it vacuums;
 * - a `climbing` person climbs.
 *
 * The glide is how the hop is fixed: the engine moves a person once per sim
 * step (about 10 a second at the slowest speed, a whole minute of walking at
 * a time), so the drawn figure eases from where it was drawn to the engine's
 * new position over one step's length instead of jumping there.
 */

export const POSES: readonly Pose[] = ["walk", "stand", "watch", "hips", "armsUp", "climb", "push", "bend", "run", "caught"];
export const MOODS: readonly Mood[] = ["content", "impatient", "fedUp"];
const POSE_CODE = new Map(POSES.map((p, i) => [p, i]));
const MOOD_CODE = new Map(MOODS.map((m, i) => [m, i]));
const FRAMES = 4;

/** Waiting past this share of the fed-up line, a person checks the time. */
export const WATCH_SHARE = 0.3;
/** Past this share, hands on hips and the impatient amber. */
export const IMPATIENT_SHARE = 0.6;

/** One figure's bake, decoded from its key. */
export interface Figure {
  readonly look: number;
  readonly pose: Pose;
  readonly frame: number;
  readonly mood: Mood;
  readonly left: boolean;
  readonly lit: boolean;
}

/** A figure's bake key: one number, so the per-frame lookup allocates nothing. */
export function figureKey(look: number, pose: Pose, frame: number, mood: Mood, left: boolean, lit: boolean): number {
  const p = POSE_CODE.get(pose) ?? 0;
  const m = MOOD_CODE.get(mood) ?? 0;
  return ((((look * POSES.length + p) * FRAMES + frame) * MOODS.length + m) * 2 + (left ? 1 : 0)) * 2 + (lit ? 1 : 0);
}

/** The figure a key names (the bake's side of `figureKey`). */
export function figureOf(key: number): Figure {
  let k = key;
  const lit = k % 2 === 1;
  k = Math.floor(k / 2);
  const left = k % 2 === 1;
  k = Math.floor(k / 2);
  const mood = MOODS[k % MOODS.length];
  k = Math.floor(k / MOODS.length);
  const frame = k % FRAMES;
  k = Math.floor(k / FRAMES);
  const pose = POSES[k % POSES.length];
  const look = Math.floor(k / POSES.length);
  return { look: Math.min(look, LOOKS.length - 1), pose, frame, mood, left, lit };
}

/** The mood a wait shows: impatient amber, then fed-up red past the line. */
export function waitMood(wait: number, fedUpWait: number): Mood {
  if (wait > fedUpWait) return "fedUp";
  if (wait > fedUpWait * IMPATIENT_SHARE) return "impatient";
  return "content";
}

/** The pose a waiting person stands in. */
export function waitPose(wait: number, fedUpWait: number): Pose {
  if (wait > fedUpWait) return "armsUp";
  if (wait > fedUpWait * IMPATIENT_SHARE) return "hips";
  if (wait > fedUpWait * WATCH_SHARE) return "watch";
  return "stand";
}

/** World pixels walked per walk frame: a foot lands every two frames of the
 *  lit four-step and every frame of the flat two-step, about a third of the
 *  figure's height per step, so the feet keep pace with the ground instead of
 *  skating over it. */
export const STRIDE_PX = { flat: 8, lit: 4 } as const;
/** The most a figure's legs count as walked in one drawn frame (tiles). A
 *  fast speed moves a figure several strides a frame; counted in full, the
 *  legs would land on a random frame each time and strobe. Capped, they keep
 *  a brisk, even cadence (a new leg frame every few drawn frames) while the
 *  body covers the ground. */
export const MAX_STRIDE_TILES = 0.15;
/** Milliseconds per vacuum or climb beat. */
export const WORK_BEAT_MS = 220;

/** The walk frame after `walkedPx` world pixels, offset per person so a crowd
 *  is not in step. The cycle follows the distance walked, never a timer. */
export function strideFrame(lit: boolean, walkedPx: number, offset: number): number {
  const px = lit ? STRIDE_PX.lit : STRIDE_PX.flat;
  return walkFrame(lit, Math.floor(walkedPx / px) + offset);
}

/** The beat frame (0 to 3) of a working or climbing figure. */
export function beatFrame(clockMs: number, offset: number): number {
  return (Math.floor(clockMs / WORK_BEAT_MS) + offset) % FRAMES;
}

// ---- The glide ---------------------------------------------------------------

/** The step clock one renderer keeps: when the engine last moved the crowd. */
export interface StepClock {
  /** The sim minute last seen; a change means a step ran. */
  minutes: number;
  /** Real milliseconds since that step. */
  sinceMs: number;
  /** How long a step lasts: the recent gaps averaged, so steps that land
   *  every one or two frames still glide at one speed; a change of pace (the
   *  lunch slowdown, a new speed) jumps straight to the new gap. */
  intervalMs: number;
  /** Real milliseconds drawn, for the walk and work beats. */
  clockMs: number;
  /** True on the frame a step landed. */
  stepped: boolean;
  /** Steps seen so far, so a change can wait for the step after it. */
  steps: number;
}

/** The longest step the glide stretches over. The slowest real gap is a
 *  one-minute step at the bottom speed in the lunch slowdown (about 3.7 s at
 *  2 game minutes a second), so this leaves room above it. */
export const MAX_STEP_MS = 4000;
/** The shortest: one frame at 120 Hz. */
export const MIN_STEP_MS = 1000 / 120;

export function newStepClock(minutes: number): StepClock {
  return { minutes, sinceMs: 0, intervalMs: 100, clockMs: 0, stepped: false, steps: 0 };
}

/** Advance the step clock by one frame of `elapsedMs`. A paused game passes
 *  0, so a figure freezes mid-glide and the pause never counts as a step. */
export function tickStepClock(c: StepClock, minutes: number, elapsedMs: number): void {
  c.clockMs += elapsedMs;
  c.stepped = minutes !== c.minutes;
  if (!c.stepped) {
    c.sinceMs += elapsedMs;
    return;
  }
  // The gap runs from the last step's frame to the frame before this one,
  // and this frame already counts toward the new step: the frame a step lands
  // on draws one frame of its travel, so a glide never holds still for a
  // frame at each step (the 3.7.0 elevator jitter).
  const gap = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, c.sinceMs));
  // The clock starts with no step behind it, so its first two gaps are taken
  // as they are rather than averaged against the starting guess.
  c.intervalMs = c.steps < 2 ? gap : smoothedInterval(c.intervalMs, gap);
  c.minutes = minutes;
  c.steps++;
  c.sinceMs = elapsedMs;
}

/** A gap more than this many times longer or shorter than the running
 *  interval is a change of pace, taken at once instead of averaged in. */
export const PACE_CHANGE = 2.5;
/** How much of each new gap the running interval takes in. */
export const GAP_WEIGHT = 0.25;

/** The step interval after one more gap: an average over recent gaps, so a
 *  speed whose steps land every one or two frames still glides evenly, or
 *  the new gap outright when the pace has changed. */
export function smoothedInterval(intervalMs: number, gapMs: number): number {
  if (gapMs > intervalMs * PACE_CHANGE || gapMs * PACE_CHANGE < intervalMs) return gapMs;
  return intervalMs + (gapMs - intervalMs) * GAP_WEIGHT;
}

/** How far through the current step the drawing is, 0 to 1. */
export function stepProgress(c: StepClock): number {
  return Math.min(1, c.sinceMs / Math.max(MIN_STEP_MS, c.intervalMs));
}

/** One drawn person's glide between the engine's last two positions. */
export interface Glide {
  fromX: number;
  toX: number;
  fromFy: number;
  toFy: number;
  x: number;
  fy: number;
  left: boolean;
  /** Tiles walked so far along the floor, for the walk cycle. */
  walked: number;
  /** Whether the last step was on a car, so the step that lets the rider off
   *  glides by the car's rule too. */
  rode: boolean;
}

/** A move shorter than this (tiles) is a shuffle, such as a waiting line
 *  closing up: it neither turns the figure nor reads as walking. */
export const SHUFFLE_TILES = 1;
/** A hop longer than this (tiles) is a jump, drawn at once. */
export const SNAP_TILES = 40;
/** A change of more than this many floors in one step is a jump too. */
export const SNAP_FLOORS = 1.5;

export function newGlide(x: number, fy: number, left: boolean): Glide {
  return { fromX: x, toX: x, fromFy: fy, toFy: fy, x, fy, left, walked: 0, rode: false };
}

/**
 * Move a glide on: on a step, start from where the figure is drawn now toward
 * the engine's new position, or jump there when the hop is too far to be a
 * walk; then draw it `progress` of the way. A person `riding` a car moves
 * with it, so they jump only when the drawn car does (`carMotion`), on the
 * step they get out included: on the walkers' shorter limit a fast car's
 * rider jumped ahead of it and hung in the empty shaft until it caught up.
 */
export function advanceGlide(g: Glide, x: number, fy: number, stepped: boolean, progress: number, show: boolean, riding = false): void {
  if (stepped || x !== g.toX || fy !== g.toFy) {
    // The step a rider gets out on is the car's last glide to their floor.
    const snapFloors = riding || g.rode ? CAR_SNAP_FLOORS : SNAP_FLOORS;
    g.rode = riding;
    const jump = !show || Math.abs(x - g.x) > SNAP_TILES || Math.abs(fy - g.fy) > snapFloors;
    g.fromX = jump ? x : g.x;
    g.fromFy = jump ? fy : g.fy;
    g.toX = x;
    g.toFy = fy;
    if (Math.abs(x - g.fromX) >= SHUFFLE_TILES) g.left = x < g.fromX;
  }
  const x0 = g.x;
  g.x = g.fromX + (g.toX - g.fromX) * progress;
  g.fy = g.fromFy + (g.toFy - g.fromFy) * progress;
  g.walked += Math.min(Math.abs(g.x - x0), MAX_STRIDE_TILES);
}

/** Whether this glide is only a shuffle in place (see `SHUFFLE_TILES`). */
export function shuffling(g: Glide): boolean {
  return Math.abs(g.toX - g.fromX) < SHUFFLE_TILES && g.toFy === g.fromFy;
}

/** Whether the drawn figure is still on its way. */
export function gliding(g: Glide): boolean {
  return g.x !== g.toX || g.fy !== g.toFy;
}
