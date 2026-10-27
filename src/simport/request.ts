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
 * with its own reason. A schedule is the engine's to harden whatever its
 * fields say (`tower.setSchedule`); the port checks only that it is plain
 * data the host can copy to the Rust engine (see {@link plain}).
 */

/** The refusal reason for a malformed command: the engine's own
 *  (`INVALID_REQUEST` in `src/engine/request.ts`; `tsSimCommands.test.ts`
 *  pins the two to the same text). */
export const INVALID_COMMAND = "That request is not valid.";

/** The most tiles one brush command may carry. The web's brush sends
 *  `STRUCTURE_BRUSH` (8); the cap keeps a hostile request's repeated passes
 *  (at most one per tile) small. */
export const MAX_BRUSH_TILES = 32;

/** The longest text one command may store (a tower name, a label, a
 *  bulletin). The web's own are far shorter (a name box holds 28); the cap
 *  keeps a hostile request from growing every save and undo step. */
export const MAX_TEXT = 4096;

type Fields = Readonly<Record<string, unknown>>;
type Check = (c: Fields, isKind: (kind: unknown) => boolean) => boolean;
/** The type a command declares for one of its fields. */
type Field<O extends CommandOp, K extends string> = Extract<Command, { op: O }>[K & keyof Extract<Command, { op: O }>];

/** A whole number both engines read the same way: the Rust binding takes
 *  floors, columns and ids as 32-bit integers and wraps anything wider. */
const whole = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= -(2 ** 31) && v <= 2 ** 31 - 1;
const finite = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
const flag = (v: unknown): boolean => typeof v === "boolean";
const text = (v: unknown): boolean => typeof v === "string" && v.length <= MAX_TEXT;
/** One of a string union's values. The record lists every value once, so a
 *  value added to the type fails to compile until it is listed here. */
const member =
  <T extends string>(values: Readonly<Record<T, true>>) =>
  (v: unknown): boolean =>
    typeof v === "string" && Object.prototype.hasOwnProperty.call(values, v);

const method = member<Field<"removeFacility", "method">>({ sell: true, bulldoze: true });
const end = member<Field<"extendTransport", "end">>({ up: true, down: true });
const policy = member<Field<"setFilmPolicy", "policy">>({ auto: true, feature: true, blockbuster: true });
const logKind = member<NonNullable<Field<"emit", "kind">>>({ info: true, good: true, bad: true, money: true });
const brushKind = member<Field<"paintBrush", "kind">>({ floor: true, lobby: true });
const batchTarget = (v: unknown): boolean => v === "default" || v === "noRate" || finite(v);

/** A brush's tiles: a dense array of whole numbers, no longer than
 *  {@link MAX_BRUSH_TILES}. An index walk, so a hole counts as a bad tile,
 *  and a getter is refused as in {@link plain}: the brush reads each tile
 *  again on every pass. */
function tileList(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > MAX_BRUSH_TILES) return false;
  for (let i = 0; i < v.length; i++) {
    const at = dataAt(v, i);
    if (at === undefined || !whole(at.value)) return false;
  }
  return true;
}
const none: Check = () => true;
const id: Check = (c) => whole(c.id);

/** A camera position the save carries: null, or plain data with a tile and
 *  floor and an optional zoom (null reads as absent, as on load). */
function view(v: unknown): boolean {
  if (v === null) return true;
  if (!plain(v) || typeof v !== "object" || Array.isArray(v)) return false;
  const at = v as Fields;
  return finite(at.tile) && finite(at.floor) && (at.zoom === undefined || at.zoom === null || finite(at.zoom));
}

/** The most values {@link plain} reads in one command: a schedule holds
 *  about 60 (two rows of 24 hours, a home floor per car and two settings). */
const MAX_VALUES = 256;

const SURROGATE = /[\uD800-\uDFFF]/;
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/** Whether `t` holds a lone UTF-16 surrogate. JSON text carries one as an
 *  escape that the Rust engine's parser refuses, so the host would fail to
 *  copy the value. Written as "take out every pair, then look for a
 *  survivor" (as `towerFileCodec.ts` does) rather than with lookbehind, which
 *  is a parse-time SyntaxError on Safari below 16.4; text with no surrogate
 *  at all, the usual case, skips the copy. */
const loneSurrogate = (t: string): boolean => SURROGATE.test(t) && SURROGATE.test(t.replace(SURROGATE_PAIR, ""));

/** A property's value when it is plain data (a hole reads as undefined), or
 *  `undefined` for a getter, which would run the caller's code during the
 *  check and could answer differently when the engine reads it. */
function dataAt(o: object, k: string | number): { readonly value: unknown } | undefined {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (d === undefined) return { value: undefined };
  return "value" in d ? { value: d.value } : undefined;
}

/** Plain data the host can copy to the Rust engine as JSON: numbers,
 *  strings, booleans, null and undefined, in arrays and plain objects at
 *  most 4 levels deep, {@link MAX_VALUES} values and {@link MAX_TEXT}
 *  characters of strings and keys in all. A BigInt, a function, a class
 *  instance (an array subclass included), a getter, an own `toJSON`, a
 *  cycle, a huge sparse array or a string with a lone surrogate is
 *  refused, since the copy would throw, run caller code, walk every slot or
 *  fail to parse in the Rust engine.
 *
 *  Three costs fall outside the budget: an object's keys are listed before
 *  it counts them, a Proxy's traps still run, and a getter on the command
 *  itself (`schedule`, `view`, `tiles`) is read here and again by the
 *  handler. Only code in the page can build a Proxy or a getter; a worker
 *  message is a structured clone of plain data, whose keys the clone has
 *  already paid to copy. */
function plain(v: unknown): boolean {
  let left = MAX_VALUES;
  let chars = MAX_TEXT;
  const str = (t: string): boolean => (chars -= t.length) >= 0 && !loneSurrogate(t);
  const walk = (x: unknown, depth: number): boolean => {
    if (--left < 0) return false;
    switch (typeof x) {
      case "string":
        return str(x);
      case "number":
      case "boolean":
      case "undefined":
        return true;
      case "object":
        break;
      default:
        return false;
    }
    if (x === null) return true;
    if (depth >= 4) return false;
    // The copy calls an own `toJSON` even when no key lists it.
    if (Object.prototype.hasOwnProperty.call(x, "toJSON")) return false;
    if (Array.isArray(x)) {
      if (Object.getPrototypeOf(x) !== Array.prototype) return false;
      if (x.length > left) return false;
      for (let i = 0; i < x.length; i++) {
        const at = dataAt(x, i);
        if (at === undefined || !walk(at.value, depth + 1)) return false;
      }
      return true;
    }
    const proto: unknown = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) return false;
    const keys = Object.keys(x);
    if (keys.length > left) return false;
    for (const k of keys) {
      const at = dataAt(x, k);
      if (at === undefined || !str(k) || !walk(at.value, depth + 1)) return false;
    }
    return true;
  };
  return walk(v, 0);
}

/** One check per command, keyed like the command list, so a command added
 *  there fails to compile until it is classified here. */
const CHECKS: { readonly [K in CommandOp]: Check } = {
  build: (c, isKind) => isKind(c.kind) && whole(c.floor) && whole(c.x),
  paintBrush: (c) => brushKind(c.kind) && whole(c.floor) && tileList(c.tiles),
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
  setSchedule: (c) => whole(c.id) && plain(c.schedule),
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
 *  tower's catalog. Constant work per command: one check per tile (at most
 *  {@link MAX_BRUSH_TILES}) for a brush, and at most {@link MAX_VALUES} values
 *  and {@link MAX_TEXT} characters for a schedule or camera. */
export function wellFormed(c: unknown, isKind: (kind: unknown) => boolean): c is Command {
  if (typeof c !== "object" || c === null) return false;
  const op = (c as Fields).op;
  if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(CHECKS, op)) return false;
  return CHECKS[op as CommandOp](c as Fields, isKind);
}
