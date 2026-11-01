import type { TemplateResult } from "lit-html";
import type { Simulation } from "../engine/Simulation";
import type { Catalog } from "../engine/catalogTypes";
import type { ElevatorSchedule } from "../engine/elevatorSchedule";
import type { BatchRentOptions, BatchRentResult, BatchTarget } from "../engine/sim/constants";
import type { FacilityKind, UnitState } from "../engine/types";
import { catalogOf } from "./portAccess";
import { Cards } from "../simport/cards";
import { PortCodes } from "../simport/portCodes";
import { scheduleFromSlots } from "../simport/scheduleSlots";
import type { EnginePort } from "../simport/enginePort";
import type { ViewReader } from "../simport/viewReader";
import { facilityDiagnostics, transportDiagnostics, transportLoadLines } from "./facilityDiagnostics";
import { recyclingLinesOf } from "./recyclingDiagnostics";
import { createPortUnitDiagnostics } from "./portUnitDiagnostics";

/**
 * Shared card data for the inspector and editor. The TypeScript engine uses
 * its existing Simulation-backed diagnostics; Rust renders the already-ported
 * unitFacts, elevator utilization and recycling records without a TypeScript
 * tower mirror. Additional report categories without port reads are tracked by #1420.
 */
export interface CardKit {
  readonly cards: Cards;
  catalog(): Catalog;
  readonly diagnostics: {
    unit(id: number, fresh?: boolean): TemplateResult[];
    invalidate(): void;
    transport(id: number): TemplateResult[];
  };
  currentSchedule(id: number): ElevatorSchedule | undefined;
  previewRentBatch(kind: FacilityKind, target: BatchTarget, opts: BatchRentOptions): BatchRentResult | null;
}

/** A batch price target as the port takes it: NaN for the default price,
 *  -1 for No Rate, otherwise the tier. */
export function batchTargetCode(target: BatchTarget): number {
  if (target === "default") return NaN;
  if (target === "noRate") return -1;
  return target;
}

/** `rentBatch`'s counters, which `quoteRentBatch` answers after its `ok`. */
export const BATCH_COUNTERS = [
  "matched",
  "eligible",
  "changed",
  "skippedSold",
  "skippedCustom",
  "customOverwritten",
  "clampedLow",
  "clampedHigh",
] as const satisfies readonly (keyof BatchRentResult)[];

/** The states a room does no work in: `isOperational`'s complement (a runtime
 *  import of the engine is off limits to this file; a test pins the two). */
export const INERT_STATES: ReadonlySet<UnitState> = new Set<UnitState>(["construction", "fire", "gutted"]);

export function createCardKit(app: { readonly enginePort: EnginePort; readonly reader: ViewReader }): CardKit {
  const port = app.enginePort;
  const codes = new PortCodes(port);
  // Read TypeScript's own simulation only on the TypeScript engine. The Rust
  // path uses facts from EnginePort and never rebuilds a mirror from a save.
  const tsTower = (): Simulation | undefined => (app.enginePort as { readonly sim?: Simulation }).sim;
  const cards = new Cards(app.enginePort, app.reader);
  const tenantLines = createPortUnitDiagnostics(port);
  // The editor's 160ms UI refresh must not run the Rust engine's full
  // congestion attribution each time. This keeps only the last unit's
  // engine-authored explanation. Its key follows the same per-hour and
  // per-revision contract as the inspector's demand memo, plus the current
  // unit card, population and stars. A user command explicitly requests a
  // fresh reading; a notice countdown stays live, minute by minute.
  let diagnosticCache: { id: number; key: string; lines: TemplateResult[] } | undefined;
  const portUnitLines = (id: number, fresh = false): TemplateResult[] => {
    const u = cards.unit(id);
    if (!u) {
      diagnosticCache = undefined;
      return [];
    }
    const header = app.reader.header;
    const key = JSON.stringify([
      port.generation(), header.revision, Math.floor(header.minutes / 60),
      header.population, header.star,
      u.kind, u.state, u.noRate, u.rent, u.price, u.satisfaction,
      u.occupants, u.residents, u.served, u.reachable, u.vacateReason,
      u.floorHasLobby,
    ]);
    // The notice deadline is an exact live countdown, not an hourly fact.
    const liveNotice = u.state === "vacating";
    let lines: TemplateResult[];
    if (!fresh && !liveNotice && diagnosticCache?.id === id && diagnosticCache.key === key) {
      lines = diagnosticCache.lines;
    } else {
      lines = tenantLines(id);
      diagnosticCache = liveNotice ? undefined : { id, key, lines };
    }
    if (u.kind === "recycling" && !INERT_STATES.has(u.state)) {
      // Recycling fill can change between hours; do not store these lines.
      return [...lines, ...recyclingLinesOf(header.population, port.recyclingCapacity(), port.recyclingFill())];
    }
    return lines;
  };
  return {
    cards,
    catalog: () => catalogOf(app),
    diagnostics: {
      invalidate: () => { diagnosticCache = undefined; },
      unit: (id, fresh = false) => {
        const sim = tsTower();
        if (!sim) return portUnitLines(id, fresh);
        const u = sim.tower.getUnit(id);
        return u ? facilityDiagnostics(sim, u) : [];
      },
      transport: (id) => {
        const sim = tsTower();
        if (!sim) return transportLoadLines(cards.shaft(id)?.utilization);
        const t = sim.tower.getTransport(id);
        return t ? transportDiagnostics(sim, t) : [];
      },
    },
    currentSchedule: (id) => scheduleFromSlots(port.shaftSchedule(id)),
    previewRentBatch: (kind, target, opts) => {
      const rec = port.quoteRentBatch(codes.kind(kind), batchTargetCode(target), opts.onlyDefaultPriced ?? false);
      if (codes.slot(rec, "quoteRentBatch", "ok") !== 1) return null;
      return Object.fromEntries(BATCH_COUNTERS.map((name) => [name, codes.slot(rec, "quoteRentBatch", name)])) as unknown as BatchRentResult;
    },
  };
}
