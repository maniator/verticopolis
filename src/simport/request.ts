import type { Command, CommandOp } from "./commands";

/**
 * The port's check of a command's shape, which every adapter runs before the
 * engine sees the command. The web's commands are typed and always well
 * formed; another frontend, a relay or a worker message may hand the port
 * anything, and the two engines read a malformed argument differently (the
 * Rust binding's glue turns NaN into 0 for a whole-number parameter and
 * throws on a kind it does not know, where TypeScript refuses some and
 * applies others). So the port refuses such a command itself, the same way
 * on every adapter, before anything moves.
 *
 * Only the shape is checked here: an id that names nothing, a floor off the
 * lot or a price out of range are well formed, and the engine refuses them
 * with its own reason. A schedule is the engine's to harden whatever it is
 * (`tower.setSchedule`), so only its shaft id is checked.
 */

/** The refusal reason for a malformed command: the engine's own
 *  (`INVALID_REQUEST` in `src/engine/request.ts`; the command contract pins
 *  the two to the same text). */
export const INVALID_COMMAND = "That request is not valid.";

type Fields = Readonly<Record<string, unknown>>;
type Check = (c: Fields, isKind: (kind: unknown) => boolean) => boolean;

const whole = (v: unknown): boolean => typeof v === "number" && Number.isSafeInteger(v);
const finite = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
const flag = (v: unknown): boolean => typeof v === "boolean";
const text = (v: unknown): boolean => typeof v === "string";
const oneOf =
  (...values: readonly unknown[]) =>
  (v: unknown): boolean =>
    values.includes(v);

const method = oneOf("sell", "bulldoze");
const end = oneOf("up", "down");
const policy = oneOf("auto", "feature", "blockbuster");
const logKind = oneOf("info", "good", "bad", "money");
const brushKind = oneOf("floor", "lobby");
const batchTarget = (v: unknown): boolean => v === "default" || v === "noRate" || finite(v);
const none: Check = () => true;
const id: Check = (c) => whole(c.id);

/** A camera position the save carries: null, or a tile and floor with an
 *  optional zoom. */
function view(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v !== "object" || Array.isArray(v)) return false;
  const at = v as Fields;
  return finite(at.tile) && finite(at.floor) && (at.zoom === undefined || finite(at.zoom));
}

/** One check per command, keyed like the command list, so a command added
 *  there fails to compile until it is classified here. */
const CHECKS: { readonly [K in CommandOp]: Check } = {
  build: (c, isKind) => isKind(c.kind) && whole(c.floor) && whole(c.x),
  // The floor and lobby brush only; the web never sends another kind.
  paintBrush: (c) => brushKind(c.kind) && whole(c.floor) && Array.isArray(c.tiles) && c.tiles.every(whole),
  buildTransport: (c, isKind) => isKind(c.kind) && whole(c.x) && whole(c.bottom) && whole(c.top),
  removeFacility: (c) => whole(c.id) && method(c.method),
  beginExtend: id,
  extendTransport: (c) => whole(c.id) && end(c.end) && whole(c.targetFloor),
  endExtend: none,
  addCar: id,
  removeCar: id,
  setStop: (c) => whole(c.id) && whole(c.floor) && flag(c.stop),
  setExpressStops: id,
  clearStops: id,
  setSchedule: id,
  setLabel: (c) => whole(c.id) && text(c.label),
  adjustRent: (c) => whole(c.id) && (c.dir === 1 || c.dir === -1),
  setNoRate: id,
  priceUnit: (c) => whole(c.id) && finite(c.target),
  applyRentBatch: (c, isKind) => isKind(c.kind) && batchTarget(c.target) && (c.onlyDefaultPriced === undefined || flag(c.onlyDefaultPriced)),
  setFilmPolicy: (c) => whole(c.id) && policy(c.policy),
  rerollSubtype: id,
  callExterminator: none,
  resolveChoice: (c) => flag(c.accept),
  toggleAutoBridge: none,
  setAutoBridge: (c) => flag(c.value),
  setTowerName: (c) => text(c.name),
  setView: (c) => view(c.view),
  emit: (c) => text(c.text) && (c.kind === undefined || logKind(c.kind)),
};

/** Whether `c` is a command the port knows, with every field of the type its
 *  command declares. `isKind` says whether a value names a facility in the
 *  tower's catalog. Constant work per command, and one check per tile for a
 *  brush. */
export function wellFormed(c: unknown, isKind: (kind: unknown) => boolean): c is Command {
  if (typeof c !== "object" || c === null) return false;
  const op = (c as Fields).op;
  if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(CHECKS, op)) return false;
  return CHECKS[op as CommandOp](c as Fields, isKind);
}
