import type { FacilityKind } from "../../shared/types";
import { RNG } from "../rng";

/**
 * The reference's copy of the Rust engine's daily venue visitors
 * (`engine-rs/src/economy/visitors.rs`, #1500), kept only so the room-fact
 * parity suites can still replay the conformance corpus on this engine. The
 * Rust module is the source of truth; see it for the rule and its evidence.
 */

const FIRST_DAY_VISITORS = 10;
const VISITOR_STEP = 5;
const MAX_VISITOR_STEPS = 3;

/** The most visitors `kind` expects in one day, or null when its census does
 *  not follow daily visitors. */
export function dailyVisitorCap(kind: FacilityKind, weekend: boolean): number | null {
  if (kind === "shop") return weekend ? 30 : 25;
  if (kind === "fastFood" || kind === "restaurant") return weekend ? 50 : 35;
  return null;
}

export function countsDailyVisitors(kind: FacilityKind): boolean {
  return dailyVisitorCap(kind, false) !== null;
}

/** What an open party hall counts in the census, and a theatre for each step
 *  of its film's draw (2 for a new film), #1500. */
export const PARTY_HALL_AUDIENCE = 50;
export const THEATRE_AUDIENCE_PER_DRAW = 40;
export const NEW_FILM_DRAW = 2;

/** Whether `kind`'s census is a set audience (party halls and theatres). */
export function countsSetAudience(kind: FacilityKind): boolean {
  return kind === "partyHall" || kind === "cinema";
}

/** Whether `kind`'s census is the count its room carries from the day before. */
export function censusFollowsTheDay(kind: FacilityKind): boolean {
  return countsDailyVisitors(kind) || countsSetAudience(kind);
}

/** The audience `kind` counts at film draw `filmDraw` (held to 0..2), or null. */
export function setAudience(kind: FacilityKind, filmDraw: number): number | null {
  if (kind === "partyHall") return PARTY_HALL_AUDIENCE;
  if (kind === "cinema") return THEATRE_AUDIENCE_PER_DRAW * (Math.min(NEW_FILM_DRAW, Math.max(0, filmDraw)) + 1);
  return null;
}

/** What a venue expects on a day, from yesterday's served visitors
 *  (undefined before its first day) and the day's climb in steps of 5. */
export function expectedVisitors(kind: FacilityKind, weekend: boolean, servedBefore: number | undefined, steps: number): number | null {
  const cap = dailyVisitorCap(kind, weekend);
  if (cap === null) return null;
  let ramp = FIRST_DAY_VISITORS;
  if (servedBefore !== undefined) {
    const climbed = Math.max(0, servedBefore) + VISITOR_STEP * Math.min(MAX_VISITOR_STEPS, Math.max(1, steps));
    ramp = climbed - (climbed % VISITOR_STEP);
  }
  return Math.min(ramp, cap);
}

/** The steps (1 to 3) venue `unitId` climbs on `day`, from the tower's founding seed. */
export function climbSteps(towerSeed: number, day: number, unitId: number): number {
  const dayBits = Math.imul(day, 0x9e3779b1);
  const unitBits = Math.imul(unitId, 0x85ebca77);
  return new RNG((towerSeed ^ dayBits ^ unitBits) >>> 0).int(1, MAX_VISITOR_STEPS);
}

/** The visitors a venue served: what it expected, unless fewer reached it. */
export function servedVisitors(expected: number, patronage: number): number {
  const drawn = Number.isFinite(patronage) ? Math.floor(Math.max(0, patronage)) : 0;
  return Math.min(expected, drawn);
}
