import type { FacilityKind } from "../engine/types";

/**
 * What the live TypeScript simulation receives, written down so a second
 * engine can receive the same (story-engine-dual-run). One command per
 * mutation the host can make: the engine's own command methods, the tower
 * edits the editor makes, and the plain writes the host makes to fields the
 * save carries (money, the camera, the tower's name, the log). A checkpoint
 * carries the live engine's two hashed views as canonical JSON, taken at an
 * hour boundary, for the shadow to compare against its own.
 *
 * A tower starts the shadow with `load`: the live tower's own save plus its
 * boundary markers (see {@link BoundaryMarkers}). `gen` counts the loads, so
 * a checkpoint's answer, or an error, can be told from a previous tower's.
 */
export type ShadowCommand =
  | { op: "load"; gen: number; save: string; markers: BoundaryMarkers }
  | { op: "tick"; dt: number }
  | { op: "build"; kind: FacilityKind; floor: number; x: number }
  | { op: "buildTransport"; kind: FacilityKind; x: number; bottom: number; top: number }
  | { op: "sellAt"; floor: number; x: number }
  | { op: "removeUnit"; id: number }
  | { op: "removeTransport"; id: number }
  | { op: "resizeTransport"; id: number; bottom: number; top: number }
  | { op: "setCars"; id: number; cars: number }
  | { op: "addCar"; id: number }
  | { op: "removeCar"; id: number }
  | { op: "extendTransport"; id: number; end: "up" | "down"; targetFloor: number; hwm: { bottom: number; top: number } | null }
  | { op: "removeFacility"; id: number; method: "sell" | "bulldoze" }
  | { op: "setSchedule"; id: number; schedule: unknown }
  | { op: "setStop"; id: number; floor: number; stop: boolean }
  | { op: "setExpressStops"; id: number }
  | { op: "clearStops"; id: number }
  | { op: "adjustRent"; id: number; dir: 1 | -1 }
  | { op: "setNoRate"; id: number }
  | { op: "priceUnit"; id: number; target: number }
  | { op: "applyRentBatch"; kind: FacilityKind; target: number | "default" | "noRate"; onlyDefaultPriced: boolean }
  | { op: "setFilmPolicy"; id: number; policy: "auto" | "feature" | "blockbuster" }
  | { op: "rerollSubtype"; id: number }
  | { op: "toggleAutoBridge" }
  | { op: "setAutoBridge"; value: boolean }
  | { op: "setLabel"; id: number; label: string }
  | { op: "setTowerName"; name: string | null }
  | { op: "setView"; view: unknown }
  | { op: "setMoney"; amount: number }
  | { op: "emit"; text: string; kind: string }
  | { op: "startFire" }
  | { op: "bombThreat" }
  | { op: "evaluateStar" }
  | { op: "callExterminator" }
  | { op: "resolveChoice"; accept: boolean }
  | { op: "checkpoint"; gen: number; label: string; state: string; crowd: string };

/** The live engine's boundary markers, which a save does not carry: a load
 *  rebuilds them from the clock, while a founded game keeps them unset until
 *  its first boundary, so the shadow takes them over verbatim. */
export interface BoundaryMarkers {
  lastHour: number;
  lastDay: number;
  lastQuarter: number;
  lastMonth: number;
}

/** Where a shadow's state first departs from the live engine's. */
export interface Divergence {
  label: string;
  /** Which of the two hashed views differs. */
  view: "state" | "crowd";
  /** The JSON path of the first differing value, in key order. */
  path: string;
  live: unknown;
  shadow: unknown;
}
