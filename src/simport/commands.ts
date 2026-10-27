import type { BatchRentResult, BatchTarget } from "../engine/sim/constants";
import type { FacilityKind, LogEntry, SerializedView } from "../engine/types";

/**
 * The player commands the game sends through the port, one member per
 * command the consumer inventory's 1C table lists. `op` names the command,
 * as it does in `ShadowCommand` (`src/dualrun/commands.ts`), so the fields
 * keep the names today's calls use (`kind` is a facility kind, as in
 * `sim.build(kind, floor, x)`). `view.types.test.ts` pins this list against
 * `ShadowCommand`'s player ops, so a command added to one is classified in
 * the other.
 *
 * Left out on purpose: `sellAt`, `setCars`, `resizeTransport` and the
 * tower's resize and car setters (no production caller); `removeUnit` and
 * `removeTransport`, the tower's raw removes, which loaders and tests use
 * while players remove through `removeFacility`; and `startFire`,
 * `bombThreat`, `evaluateStar` and money writes (tests and tooling only).
 */
export type Command =
  | { op: "build"; kind: FacilityKind; floor: number; x: number }
  | { op: "buildTransport"; kind: FacilityKind; x: number; bottom: number; top: number }
  | { op: "removeFacility"; id: number; method: "sell" | "bulldoze" }
  | { op: "beginExtend"; id: number }
  | { op: "extendTransport"; id: number; end: "up" | "down"; targetFloor: number }
  | { op: "endExtend" }
  | { op: "addCar"; id: number }
  | { op: "removeCar"; id: number }
  | { op: "setStop"; id: number; floor: number; stop: boolean }
  | { op: "setExpressStops"; id: number }
  | { op: "clearStops"; id: number }
  /** `schedule` is validated by the engine, as `tower.setSchedule` does. */
  | { op: "setSchedule"; id: number; schedule: unknown }
  | { op: "setLabel"; id: number; label: string }
  | { op: "adjustRent"; id: number; dir: 1 | -1 }
  | { op: "setNoRate"; id: number }
  | { op: "priceUnit"; id: number; target: number }
  | { op: "applyRentBatch"; kind: FacilityKind; target: BatchTarget; onlyDefaultPriced?: boolean }
  | { op: "setFilmPolicy"; id: number; policy: FilmPolicy }
  | { op: "rerollSubtype"; id: number }
  | { op: "callExterminator" }
  /** Answers the pending emergency: `true` pays, `false` takes the default. */
  | { op: "resolveChoice"; accept: boolean }
  | { op: "toggleAutoBridge" }
  | { op: "setAutoBridge"; value: boolean }
  | { op: "setTowerName"; name: string }
  /** The camera the next save carries; the engine never reads it. */
  | { op: "setView"; view: SerializedView | null }
  /** A bulletin line; `kind` is the log kind, `info` when left out. */
  | { op: "emit"; text: string; kind?: LogEntry["kind"] };

export type FilmPolicy = "auto" | "feature" | "blockbuster";

/** What every command answers. `ok` is false on a refusal, with the
 *  engine's `reason` when it gives one. `delta` is the signed change the
 *  command made to the balance, measured the same way for every command:
 *  negative for a charge, positive for a refund or an excavation find, and 0
 *  when no money moved (always on a refusal). */
export interface BaseResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly delta: number;
}

/** Each command's answer: the base fields plus what its callers read today. */
export interface CommandResults {
  build: BaseResult;
  buildTransport: BaseResult;
  removeFacility: BaseResult;
  beginExtend: BaseResult;
  /** The shaft's ends afterwards and how many floors were billed. */
  extendTransport: BaseResult & { readonly bottom: number; readonly top: number; readonly added: number };
  /** Closes the drag; always succeeds, open or not. */
  endExtend: BaseResult;
  addCar: BaseResult;
  removeCar: BaseResult;
  setStop: BaseResult;
  setExpressStops: BaseResult;
  clearStops: BaseResult;
  setSchedule: BaseResult;
  setLabel: BaseResult;
  /** The unit's new rent, when the change applied. */
  adjustRent: BaseResult & { readonly rent?: number };
  setNoRate: BaseResult;
  /** The unit's new rent, when the price applied. */
  priceUnit: BaseResult & { readonly rent?: number };
  /** The batch's tally; refused for a kind that carries no rent. */
  applyRentBatch: BaseResult & { readonly batch?: BatchRentResult };
  /** The policy now in force, when the change applied. */
  setFilmPolicy: BaseResult & { readonly policy?: FilmPolicy };
  /** The new subtype, when the reroll applied. */
  rerollSubtype: BaseResult & { readonly subtype?: string };
  /** The booking's price and the rooms it treats, when booked. */
  callExterminator: BaseResult & { readonly reason?: "unavailable" | "pending" | "none" | "funds"; readonly cost?: number; readonly rooms?: number };
  /** Refused when no emergency is waiting. Accepting without the funds
   *  takes the default, as the engine does; `delta` shows which happened. */
  resolveChoice: BaseResult;
  /** The preference now in force; refused when it did not change (a
   *  Classic tower always bridges). */
  toggleAutoBridge: BaseResult & { readonly value: boolean };
  /** Refused when it would turn bridging off in a Classic tower. */
  setAutoBridge: BaseResult & { readonly value: boolean };
  setTowerName: BaseResult;
  setView: BaseResult;
  emit: BaseResult;
}

export type CommandOp = Command["op"];
export type CommandResult<C extends Command> = CommandResults[C["op"]];
