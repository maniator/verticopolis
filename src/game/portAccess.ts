import type { Catalog } from "../engine/catalogTypes";
import { catalogOn, useTowerCatalogSource } from "../engine/towerCatalog";
import type { FacilityKind } from "../engine/types";
import type { EnginePort } from "../simport/enginePort";
import type { PortCodes } from "../simport/portCodes";
import { PortRenderSim } from "../simport/portRenderSim";
import type { SimView } from "../simport/view";
import { bindViewKinds, facilityFloors } from "../presentation/viewKinds";
import { ViewReader } from "../simport/viewReader";

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

/** The catalog of the mode the reader shows, from the engine's catalog
 *  source: boot points the Rust engine at its own tables
 *  (`useTowerCatalogSource`), and the TypeScript engine reads the TypeScript
 *  tables. The engine is only a key here, never asked a question. */
export function catalogOf(app: { readonly enginePort: object; readonly reader: Pick<SimView, "header"> }): Catalog {
  return catalogOn(app.enginePort, app.reader.header.mode);
}

/** The reader of `port`'s frame. It asks each kind's height on its first update,
 *  before the scene is built, so the view's kind facts are bound first (both
 *  modes' catalogs state the same facts). */
export function newViewReader(port: EnginePort): ViewReader {
  bindViewKinds(catalogOn(port, "modern"));
  return new ViewReader(port, facilityFloors);
}

/** What the renderer draws for `port`: the render sim reads its catalog from the
 *  engine's source, so a room is sized as the engine sizes it (the Rust engine's
 *  wedding hall is five stories; the TypeScript tables hold one). */
export function newRenderSim(port: EnginePort, reader: ViewReader): PortRenderSim {
  const sim = new PortRenderSim(port, reader);
  useTowerCatalogSource(sim, (mode) => catalogOn(port, mode));
  return sim;
}

/** Whether the tower has unlocked `kind` (the star gate, and Modern-only
 *  kinds in a Classic tower), from the reader's header as of its last update. */
export function isUnlocked(app: { readonly reader: Pick<ViewReader, "unlocked"> }, kind: FacilityKind): boolean {
  return app.reader.unlocked(kind);
}
