import type { Catalog } from "../engine/catalogTypes";
import type { Simulation } from "../engine/Simulation";
import { towerCatalog } from "../engine/towerCatalog";
import type { FacilityKind, GameMode } from "../engine/types";
import type { EnginePort } from "../simport/enginePort";
import type { PortCodes } from "../simport/portCodes";
import type { SimView } from "../simport/view";

/**
 * What the game's callers read through the engine port to price and preview a
 * placement (contract section 7), kept in one place so each caller makes one
 * port call per question. The answers carry the engine's own refusal text, so a
 * preview and the command that follows say the same thing.
 */

/** The answer to "can this be built here, and for how much". */
export interface BuildQuote {
  readonly ok: boolean;
  readonly cost: number;
  /** The refusal text; only when `ok` is false. */
  readonly reason?: string;
}

/** `quoteBuild` as the callers read it. Call it before the next
 *  status-producing member, which replaces `lastReason()`. */
export function quoteBuild(port: EnginePort, codes: PortCodes, kind: FacilityKind, floor: number, x: number): BuildQuote {
  const rec = port.quoteBuild(codes.kind(kind), floor, x);
  const ok = codes.slot(rec, "quoteBuild", "ok") === 1;
  return { ok, cost: codes.slot(rec, "quoteBuild", "cost"), reason: ok ? undefined : port.lastReason() };
}

/** `quoteShaft` as the callers read it: whether a shaft fits, and why not. */
export function quoteShaft(
  port: EnginePort,
  codes: PortCodes,
  kind: FacilityKind,
  x: number,
  bottom: number,
  top: number,
): { readonly ok: boolean; readonly reason?: string } {
  const ok = codes.slot(port.quoteShaft(codes.kind(kind), x, bottom, top), "quoteShaft", "ok") === 1;
  return { ok, reason: ok ? undefined : port.lastReason() };
}

const catalogKeys = new WeakMap<object, { readonly mode: GameMode }>();

/** The catalog of the tower the view shows. The catalog handle keeps what it
 *  reads per object, so the key is one object per view: the header is
 *  replaced on every update. */
export function catalogOf(view: Pick<SimView, "header">): Catalog {
  const mode = view.header.mode;
  let key = catalogKeys.get(view);
  if (!key) catalogKeys.set(view, (key = { mode }));
  return towerCatalog(key, mode);
}

/**
 * GAP: the port has no member that says whether a kind is unlocked (the star
 * gate, and Modern-only kinds in a Classic tower), and no quote answers it
 * without also asking about money or placement. This is the one read left on
 * the simulation; the Rust engine's answer replaces it when the boot path
 * moves.
 */
export function isUnlocked(app: { readonly sim: Pick<Simulation, "isUnlocked"> }, kind: FacilityKind): boolean {
  return app.sim.isUnlocked(kind);
}
