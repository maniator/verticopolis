import type { EnginePort, PortRecord } from "./enginePort";

/**
 * The rooms' evaluation and rent tiers, the read the Map's Eval and Pricing
 * views color rooms by (#343 S7). The engine decides every tier
 * (`engine-rs/src/panels/room_tiers.rs`), so this file compares no score and
 * no price: it names the slots and the codes of the port's `roomTiers`
 * record, which the port's own `viewLayout()` lists, and reads them in place.
 *
 * One read is one call across the boundary and one record, with a `roomTier`
 * row per room that carries an evaluation or a rent level, in the view's room
 * order (`SimView.rooms`); a room's `id` matches its `UnitView.id`. The batch
 * wraps that record: reading a row's fields allocates nothing. The engine
 * walks the rooms for each read, so S8 reads only on the triggers the Map
 * SPEC lists (`_bmad-output/specs/spec-overview-map/SPEC.md`, the Cost
 * bullet of the S7 section), and not more than once a frame.
 *
 * Build the reader on the app's port (`GameApp.enginePort`), which is one
 * engine object for the whole page life. A load, a new tower, an undo or redo
 * restore and a `.TDT` adopt swap the tower inside that object and move its
 * `generation()`; the layout stays, so the reader stays valid and needs no
 * rebuild. A batch read before a swap names the old rooms (a loaded or new
 * tower has new room ids, and an undo or redo changes rooms in place), so
 * drop it and read again once the app follows the swap
 * (`GameApp.followSwap`).
 */

/** A room's evaluation: Terrible, Good or Excellent, as the original's Eval
 *  view sorts them, or `unrated` for a room with no evaluation: a kind that
 *  carries none (a room listed for its price alone), or a room with nobody in
 *  it to rate it. */
export type EvalTier = "unrated" | "terrible" | "good" | "excellent";

/** A room's rent level: the original's four Pricing tiers, `noRate` for a
 *  room the player took off the market, or `unpriced` for a kind that has no
 *  rent in the tower's mode. */
export type RentTier = "unpriced" | "noRate" | "veryLow" | "low" | "average" | "high";

/** Every evaluation tier, worst to best after `unrated`. */
export const EVAL_TIERS = ["unrated", "terrible", "good", "excellent"] as const satisfies readonly EvalTier[];

/** Every rent tier, lowest to highest after `unpriced` and `noRate`. */
export const RENT_TIERS = ["unpriced", "noRate", "veryLow", "low", "average", "high"] as const satisfies readonly RentTier[];

/** The slots of one `roomTier` row. */
export type RoomTierSlot = "id" | "floor" | "x" | "evalTier" | "rentTier";

const ROOM_TIER_SLOTS = ["id", "floor", "x", "evalTier", "rentTier"] as const satisfies readonly RoomTierSlot[];

/** The port members the reader calls. */
export type RoomTierPort = Pick<EnginePort, "viewLayout" | "roomTiers">;

/** What the layout says about the record: where each slot sits in a row, how
 *  wide a row is, and the tier each code names. */
interface RowShape {
  readonly at: Readonly<Record<RoomTierSlot, number>>;
  readonly width: number;
  readonly evalOf: readonly EvalTier[];
  readonly rentOf: readonly RentTier[];
}

/** The layout's parts the reader reads, unchecked until `roomTierShape`
 *  checks them. */
interface Layout {
  readonly records?: Readonly<Record<string, unknown>> | null;
  readonly evalTiers?: unknown;
  readonly rentTiers?: unknown;
}

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** `names` as tiers of `known`, in code order, or null when it is not a
 *  list, lists a name `known` lacks, or leaves one out. */
function tierTable<T extends string>(names: unknown, known: readonly T[]): T[] | null {
  if (!isList(names) || names.length !== known.length) return null;
  const table = names.filter((n): n is T => typeof n === "string" && (known as readonly string[]).includes(n));
  return table.length === known.length && new Set(table).size === known.length ? table : null;
}

/** The layout text as an object, or null when it is not JSON or not an
 *  object. */
function parseLayout(layoutText: string): Layout | null {
  try {
    const layout: unknown = JSON.parse(layoutText);
    return typeof layout === "object" && layout !== null ? (layout as Layout) : null;
  } catch {
    return null;
  }
}

/** The record's shape from the layout, or null for a layout that cannot
 *  carry the read: one without it (an engine package built before it), text
 *  that is not JSON, a slot list or tier table that is not a list, or a slot
 *  list that names a slot twice. */
export function roomTierShape(layoutText: string): RowShape | null {
  const layout = parseLayout(layoutText);
  const slots: unknown = layout?.records?.roomTier;
  const evalOf = tierTable(layout?.evalTiers, EVAL_TIERS);
  const rentOf = tierTable(layout?.rentTiers, RENT_TIERS);
  if (!isList(slots) || !evalOf || !rentOf) return null;
  if (new Set(slots).size !== slots.length || !ROOM_TIER_SLOTS.every((slot) => slots.includes(slot))) return null;
  const at = Object.fromEntries(ROOM_TIER_SLOTS.map((slot) => [slot, slots.indexOf(slot)])) as Record<RoomTierSlot, number>;
  return { at, width: slots.length, evalOf, rentOf };
}

/** One read's rows. Row `i` runs from 0 to `size - 1`; every accessor throws
 *  a RangeError for any other `i`. */
export class RoomTiers {
  /** How many rooms the read listed. */
  readonly size: number;

  constructor(
    private readonly rec: PortRecord,
    private readonly shape: RowShape,
  ) {
    this.size = Math.floor(rec.length / shape.width);
  }

  /** Throws a RangeError unless `i` is a whole number from 0 to
   *  `size - 1`, so a bad index never reads another row's slot. */
  private slot(i: number, slot: RoomTierSlot): number {
    if (!Number.isInteger(i) || i < 0 || i >= this.size) throw new RangeError(`room tier row ${i} is outside 0..${this.size - 1}`);
    return this.rec[i * this.shape.width + this.shape.at[slot]];
  }

  /** The room's unit id, as `UnitView.id` carries it. */
  id(i: number): number {
    return this.slot(i, "id");
  }

  /** The floor of the room's anchor tile. */
  floor(i: number): number {
    return this.slot(i, "floor");
  }

  /** The x of the room's anchor tile. */
  x(i: number): number {
    return this.slot(i, "x");
  }

  /** The room's evaluation. A code the layout does not name reads as
   *  `unrated`, so it paints as an unrated room. */
  evalTier(i: number): EvalTier {
    return this.shape.evalOf[this.slot(i, "evalTier")] ?? "unrated";
  }

  /** The room's rent level. A code the layout does not name reads as
   *  `unpriced`. */
  rentTier(i: number): RentTier {
    return this.shape.rentOf[this.slot(i, "rentTier")] ?? "unpriced";
  }
}

/** The shape of a batch with no rows; it is never read. */
const NO_SHAPE: RowShape = {
  at: Object.fromEntries(ROOM_TIER_SLOTS.map((slot, i) => [slot, i])) as Record<RoomTierSlot, number>,
  width: ROOM_TIER_SLOTS.length,
  evalOf: [],
  rentOf: [],
};

/** The batch with no rows. */
export const NO_ROOM_TIERS = new RoomTiers(new Float64Array(0), NO_SHAPE);

/**
 * Reads the rooms' tiers from a port. Build one per app, on the app's port
 * (see the file's note on swaps); it parses the layout once, and the layout
 * does not change across a swap.
 */
export class RoomTierReader {
  private readonly shape: RowShape | null;

  constructor(private readonly port: RoomTierPort) {
    this.shape = roomTierShape(port.viewLayout());
  }

  /** Whether this engine answers the read. The TypeScript reference and an
   *  engine package built before the read do not. */
  get available(): boolean {
    return this.shape !== null && typeof this.port.roomTiers === "function";
  }

  /** The tiers the engine gives now: one call across the boundary and one
   *  pass over the rooms in the engine. No rows when the engine has no such
   *  read, and none for an answer that is missing or is not whole rows,
   *  since a part row means every row is out of step with its slots. On an
   *  engine that answers the read (`available`), `NO_ROOM_TIERS` is the
   *  failed-read signal. */
  read(): RoomTiers {
    const shape = this.shape;
    if (shape === null || typeof this.port.roomTiers !== "function") return NO_ROOM_TIERS;
    const answer: PortRecord | null | undefined = this.port.roomTiers();
    if (answer == null || answer.length % shape.width !== 0) return NO_ROOM_TIERS;
    return new RoomTiers(answer, shape);
  }
}
