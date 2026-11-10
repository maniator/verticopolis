/**
 * The crowd view as the port-edit scripts read it (`portEdits.ts`): the
 * people, each on a route, and the id the next person takes. A view the
 * scripts cannot read is refused, saying why, so no check passes on a
 * misread view. It also says whether a shaft stops at a route leg's floors.
 */

/** The state a person is in while walking to the shaft their current leg
 *  takes, as both engines' crowd views name it. */
export const WALKING_TO_SHAFT = "toShaft";

/** A person in the crowd view, as the scripts read one: leg `i` of the
 *  route goes from `floors[i]` to `floors[i + 1]` by `shafts[i]`, `leg` is
 *  the one the person is on (the route's length once it is done), and
 *  `state` says what they are doing on it. */
export interface CrowdPerson {
  readonly id: number;
  readonly floors: readonly number[];
  readonly shafts: readonly number[];
  readonly leg: number;
  readonly state: string;
}

/** The crowd view as the scripts read it. */
export interface CrowdView {
  readonly nextId: number;
  readonly people: readonly CrowdPerson[];
}

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isIntegerList = (list: unknown): list is number[] => Array.isArray(list) && list.every(isInteger);

/** Whether a crowd view entry is a `CrowdPerson`: integer fields and a
 *  state given as text, one more floor than shafts (a trip on one floor
 *  has one floor and no shaft) or neither (a person with no route), and a
 *  leg inside the route. */
export function isCrowdPerson(entry: unknown): entry is CrowdPerson {
  if (typeof entry !== "object" || entry === null) return false;
  const { id, floors, shafts, leg, state } = entry as Record<string, unknown>;
  if (!isInteger(id) || !isIntegerList(floors) || !isIntegerList(shafts) || !isInteger(leg) || typeof state !== "string") return false;
  const routed = floors.length === shafts.length + 1 || (floors.length === 0 && shafts.length === 0);
  return routed && leg >= 0 && leg <= shafts.length;
}

/** What keeps the scripts from reading a crowd view, if anything: the next
 *  person id must be an integer above every person's, each person a
 *  `CrowdPerson`, and no id listed twice. */
export function crowdProblem(view: unknown): string | undefined {
  if (typeof view !== "object" || view === null) return "is not an object";
  const { nextId, people } = view as Record<string, unknown>;
  if (!isInteger(nextId)) return `has a next person id of ${String(nextId)}`;
  if (!Array.isArray(people)) return "has no list of people";
  const unread = people.findIndex((p) => !isCrowdPerson(p));
  if (unread >= 0) return `has a person at index ${unread} the scripts cannot read`;
  const seen = new Set<number>();
  for (const { id } of people as CrowdPerson[]) {
    if (id >= nextId) return `has person ${id}, at or above the next person id ${nextId}`;
    if (seen.has(id)) return `has person ${id} twice`;
    seen.add(id);
  }
  return undefined;
}

/** The ids of the people walking to the shaft their current leg takes. */
export function walkingTo(view: CrowdView, shaftId: number): number[] {
  return view.people.filter((p) => p.state === WALKING_TO_SHAFT && p.leg < p.shafts.length && p.shafts[p.leg] === shaftId).map((p) => p.id);
}

/** The legs of a person's route still ahead, counting the one they are on. */
export const legsAhead = (p: CrowdPerson): number => p.shafts.length - p.leg;

/** The fewest legs ahead, the current one included, for a person to be
 *  midway. A person still on their first leg is midway when two legs are
 *  ahead, since they have set out. One frame can end the current leg, so a
 *  person with one leg ahead may arrive within it, and is left out. */
export const MIDWAY_LEGS_AHEAD = 2;

/** The ids of the people midway on a route that never takes the shaft. */
export function midRouteAvoiding(view: CrowdView, shaftId: number): number[] {
  return view.people.filter((p) => legsAhead(p) >= MIDWAY_LEGS_AHEAD && !p.shafts.includes(shaftId)).map((p) => p.id);
}

/** The shafts of the route legs between two floors, either way, of the
 *  people whose id is at least `sinceId`. */
export function shaftsBetween(view: CrowdView, a: number, b: number, sinceId: number): number[] {
  const joins = (from: number, to: number): boolean => (from === a && to === b) || (from === b && to === a);
  return view.people.filter((p) => p.id >= sinceId).flatMap((p) => p.shafts.filter((_, i) => joins(p.floors[i], p.floors[i + 1])));
}

/** A shaft's floors as the save lists them: its span and the floors it
 *  skips. */
export interface ShaftStops {
  readonly bottom: number;
  readonly top: number;
  readonly skipFloors?: readonly number[];
}

/** Whether a shaft stops at a floor, as both engines decide it: inside its
 *  span and not on its skip list. */
export const stopsAt = (shaft: ShaftStops, floor: number): boolean => floor >= shaft.bottom && floor <= shaft.top && !(shaft.skipFloors ?? []).includes(floor);

/** Whether there is a shaft and it stops at both floors. */
export const stopsAtBoth = (shaft: ShaftStops | undefined, a: number, b: number): boolean => shaft !== undefined && stopsAt(shaft, a) && stopsAt(shaft, b);
