import type { EnginePort } from "../simport/enginePort";
import type { PortCodes } from "../simport/portCodes";
import type { FacilityKind } from "../shared/types";

/**
 * The row of rooms (Modern, #646): one drag along a floor places the same room
 * as many times as fits, from the press toward the pointer. The engine finds
 * the rooms and prices the row (`quoteRoomRow`), so the ghost shows every room
 * a release places and the row's full price before the release;
 * `buildRoomRow` places them. The rules live in `engine-rs/src/sim_room_row.rs`.
 */

/** The engine's answer for a drag: each room's left tile, the row's full
 *  price, and why not. */
export interface RoomRowQuote {
  readonly ok: boolean;
  readonly cost: number;
  /** Each room's left tile, in the order the row places them. */
  readonly rooms: readonly number[];
  /** The refusal text; only when `ok` is false. */
  readonly reason?: string;
}

/** `quoteRoomRow` as the callers read it: its header by name, then the rooms.
 *  Call it before the next status-producing member, which replaces
 *  `lastReason()`. */
export function quoteRoomRow(port: EnginePort, codes: PortCodes, kind: FacilityKind, floor: number, from: number, to: number): RoomRowQuote {
  const rec = port.quoteRoomRow(codes.kind(kind), floor, from, to);
  const ok = codes.slot(rec, "quoteRoomRow", "ok") === 1;
  const count = codes.slot(rec, "quoteRoomRow", "rooms");
  // The rooms follow the header's named slots.
  const header = codes.fields("quoteRoomRow").length;
  const rooms = Array.from(rec.subarray(header, header + count));
  return { ok, cost: codes.slot(rec, "quoteRoomRow", "cost"), rooms, reason: ok ? undefined : port.lastReason() };
}

/** The ghost's price tag: the row's full price and how many rooms it places;
 *  none for a single room, whose price the tool card already shows. */
export function roomRowLabel(q: RoomRowQuote, money: (n: number) => string): string | undefined {
  const n = q.rooms.length;
  if (n < 2) return undefined;
  return `$${money(q.cost)}, ${n} rooms`;
}

/** The `detail` of the `room_row` action: how many rooms a row placed, in
 *  bands, so the dashboard reads how long rows run without a free number. */
export function roomRowBand(placed: number): "2-4" | "5-9" | "10+" {
  if (placed >= 10) return "10+";
  return placed >= 5 ? "5-9" : "2-4";
}
