import type { PersonState } from "../engine/crowd/person";
import type { CalendarKind } from "../engine/calendar";
import type { FacilityKind, GameMode, UnitState, WeatherKind } from "../engine/types";

/**
 * What the game reads from the simulation to draw it and to fill the HUD,
 * read-only all the way down (spine AD-9, the facade review's 5.2). The
 * members are the ones the renderer and the HUD read today (the consumer
 * inventory's buckets 2S and 2F); later slices add members here and never
 * drop one silently.
 *
 * The TypeScript adapter hands out the live `Tower`, `Crowd`, units,
 * transports and people, which `view.types.test.ts` proves assignable to
 * these types, so a read copies nothing. A Rust adapter fills the same shapes
 * from the engine's structural snapshot and frame. Either way a reader treats
 * what it gets as valid until the next tick or command, and keeps the values
 * it needs rather than the objects.
 */
export interface SimView {
  readonly header: HeaderView;
  readonly tower: TowerView;
  readonly crowd: CrowdView;
}

/** The scalar state the HUD and the renderer's triggers read. */
export interface HeaderView {
  readonly money: number;
  /** 1 to 5 stars, 6 for TOWER. */
  readonly star: number;
  /** The TypeScript engine walks every room to answer this (O(R), about
   *  330 µs on the large tower), so a reader takes it at most once per step
   *  or per HUD tick, or keeps one header for that span, and never per frame. */
  readonly population: number;
  readonly weather: WeatherKind;
  /** The bulletin log's monotonic cursor. */
  readonly logSeq: number;
  readonly pendingChoice: PendingChoiceView | null;
  /** The game clock in minutes since the start. */
  readonly minutes: number;
  readonly minuteOfDay: number;
  /** Moves whenever a unit or transport is added or removed. */
  readonly revision: number;
  /** Moves whenever the meal overlay's inputs change. */
  readonly mealOverlayRevision: number;
  /** The tower's rule set. Fixed at founding and stored as the save stores
   *  it; a panel derives the rules from it (`headerClock.ts`). */
  readonly mode: GameMode;
  /** The calendar a Modern tower chose at founding, stored as the save
   *  stores it (a Classic tower always runs the canon calendar whatever this
   *  says); with `mode` it gives the clock's day names (`headerClock.ts`). */
  readonly modernCalendar: CalendarKind;
  /** The visual-effect counters: a change in a `seq` (or a `*Seq` counter)
   *  fires one visual. A reader keeps the last value it saw, so this is
   *  cheap to take every frame. */
  readonly fx: FxView;
  /** The saved camera, or null when the tower has none. Read on construction
   *  and on a tower swap to restore it, not per frame; the live camera is the
   *  renderer's, and `setView` is the command that stores it. */
  readonly camera: CameraView | null;
}

/** Where the camera was when the tower was saved. */
export interface CameraView {
  /** The tile the view is centered on. */
  readonly tile: number;
  readonly floor: number;
  /** Absent in saves from before zoom was stored. */
  readonly zoom?: number;
}

/** The effect counters the renderer turns into visuals. */
export interface FxView {
  readonly santaSeq: number;
  readonly vipSeq: number;
  readonly explosion: { readonly floor: number; readonly x: number; readonly seq: number };
  readonly thief: { readonly caught: boolean; readonly floor: number; readonly seq: number };
  readonly treasure: { readonly floor: number; readonly x: number; readonly seq: number };
}

/** An emergency waiting on the player's answer. */
export interface PendingChoiceView {
  readonly kind: "fireRescue" | "bombThreat";
  readonly cost: number;
  readonly message: string;
}

export interface TowerView {
  /** Every unit, the bare floor and lobby tiles included (about 40,000 of the
   *  large tower's 43,358). A Rust adapter builds this array at most once per
   *  revision, never per read. A reader that needs only rooms, or the
   *  structure, does not walk it per frame or per step; a room list and
   *  structure runs come with #1253. */
  readonly units: ReadonlyArray<UnitView>;
  readonly transports: ReadonlyArray<TransportView>;
  readonly revision: number;
  readonly mealOverlayRevision: number;
  readonly towerName: string;
  readonly highestFloor: number;
  readonly lowestFloor: number;
  getUnit(id: number): UnitView | undefined;
  getTransport(id: number): TransportView | undefined;
  unitAt(floor: number, x: number): UnitView | undefined;
  hasStructure(floor: number, x: number): boolean;
  structureKindAt(floor: number, x: number): "floor" | "lobby" | undefined;
}

export interface UnitView {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly floor: number;
  readonly x: number;
  readonly width: number;
  readonly state: UnitState;
  readonly subtype?: string;
  readonly label: string;
  readonly occupants: number;
  readonly outForMeal?: number;
  readonly customersIn?: number;
  readonly hotelCustomersIn?: number;
}

export interface TransportView {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly x: number;
  readonly width: number;
  readonly bottom: number;
  readonly top: number;
  readonly cars: number;
  readonly skipFloors?: ReadonlyArray<number>;
  readonly carPositions: ReadonlyArray<number>;
  readonly carLoad?: ReadonlyArray<number>;
  readonly carDir: ReadonlyArray<number>;
}

export interface CrowdView {
  readonly people: ReadonlyArray<PersonView>;
}

export interface PersonView {
  readonly id: number;
  readonly staff?: boolean;
  readonly seed: number;
  readonly state: PersonState;
  readonly x: number;
  /** The discrete floor the person stands on or boards at. */
  readonly floor: number;
  /** The fractional floor the renderer draws the person at. */
  readonly fy: number;
  readonly wait: number;
}
