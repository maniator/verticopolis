import type { EnginePort } from "@verticopolis/engine/port/enginePort";
import type { PortCodes } from "@verticopolis/engine/port/portCodes";
import type { ViewReader } from "@verticopolis/engine/port/viewReader";

/**
 * The Sky Bridge tool (Modern; party, 2026-11-16): one click on the open air
 * between two towers' sky lobbies lays the whole bridge, or nothing. The engine
 * finds the gap and prices it (`quoteSkyBridge`), so the ghost shows every tile
 * a click lays and its full price before the click; `buildSkyBridge` lays it.
 * The rules live in `src/tower/skybridge.rs`.
 */

/** The undo step a bridge opens. */
export const SKY_BRIDGE_STEP = "Build Sky Bridge";

/** The undo step a click on a finished bridge opens: it changes the look. */
export const BRIDGE_LOOK_STEP = "Change Bridge Look";

/** What a click with the tool did: laid `tiles` tiles, or dressed a bridge in
 *  the picked look (`restyled`), or neither and why. */
export interface SkyBridgeClick {
  readonly ok: boolean;
  readonly reason?: string;
  readonly tiles: number;
  readonly restyled: boolean;
}

/** The engine's answer for a click at a cell: the tiles `from` to `to`
 *  (exclusive) it lays, their full price, and why not. */
export interface SkyBridgeQuote {
  readonly ok: boolean;
  readonly cost: number;
  readonly from: number;
  readonly to: number;
  /** The refusal text; only when `ok` is false. */
  readonly reason?: string;
}

/** The bridge a first tap on a phone showed, which a second tap lays. */
export interface ArmedSkyBridge {
  readonly floor: number;
  readonly from: number;
  readonly to: number;
}

/** `quoteSkyBridge` as the callers read it. Call it before the next
 *  status-producing member, which replaces `lastReason()`. */
export function quoteSkyBridge(port: EnginePort, codes: PortCodes, floor: number, x: number): SkyBridgeQuote {
  const rec = port.quoteSkyBridge(floor, x);
  const ok = codes.slot(rec, "quoteSkyBridge", "ok") === 1;
  return {
    ok,
    cost: codes.slot(rec, "quoteSkyBridge", "cost"),
    from: codes.slot(rec, "quoteSkyBridge", "from"),
    to: codes.slot(rec, "quoteSkyBridge", "to"),
    reason: ok ? undefined : port.lastReason(),
  };
}

/** How many tiles a quote lays; 0 when it found no gap. */
export function quotedTiles(q: SkyBridgeQuote): number {
  return Math.max(0, q.to - q.from);
}

/** Whether a click laying `q` finishes a half bridge from a save made before
 *  the tool (a bridge tile, a lobby tile over open air, stands beside it)
 *  rather than laying a new one: the `detail` of the `sky_bridge` action. */
export function finishesHalfBridge(reader: Pick<ViewReader, "tower">, floor: number, q: SkyBridgeQuote): boolean {
  const t = reader.tower;
  const bridgeAt = (x: number) =>
    t.structureKindAt(floor, x) === "lobby" && t.structureKindAt(floor - 1, x) === undefined;
  return bridgeAt(q.from - 1) || bridgeAt(q.to);
}

/** The ghost's price tag: the bridge's full price and its length. */
export function skyBridgeLabel(q: SkyBridgeQuote, money: (n: number) => string): string | undefined {
  const tiles = quotedTiles(q);
  if (tiles === 0) return undefined;
  return `$${money(q.cost)}, ${tiles} ${tiles === 1 ? "tile" : "tiles"}`;
}

/** The touch flow: a first tap shows the ghost and its price, and a second tap
 *  on the same bridge lays it. A touch has no hover, so the price would
 *  otherwise first show on the bill. */
export function tapLays(armed: ArmedSkyBridge | null, floor: number, q: SkyBridgeQuote): boolean {
  return armed !== null && armed.floor === floor && armed.from === q.from && armed.to === q.to && quotedTiles(q) > 0;
}
