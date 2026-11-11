import type { TemplateResult } from "lit-html";
import type { Catalog } from "../catalog/catalogTypes";
import type { ElevatorSchedule } from "../shared/engineTypes";
import type { BatchRentOptions, BatchRentResult, BatchTarget } from "../shared/engineTypes";
import type { FacilityKind, UnitState } from "../shared/types";
import { catalogOf } from "./portAccess";
import { Cards } from "../simport/cards";
import { PortCodes } from "../simport/portCodes";
import { scheduleFromSlots } from "../simport/scheduleSlots";
import type { EnginePort } from "../simport/enginePort";
import type { ViewReader } from "../simport/viewReader";
import { transportLoadLines } from "./cardLines";
import { recyclingLinesOf } from "./recyclingDiagnostics";
import { createPortUnitParts, joinParts, type PortUnitParts, type SupplementalLines } from "./portUnitDiagnostics";
import { portServiceSections } from "./portServiceDiagnostics";

/**
 * Shared card data for the inspector and editor, read from the engine port:
 * the unit facts, the elevator load and the recycling records the engine
 * reports, worded by the frontend. The same lines come from either engine's
 * port, and no TypeScript tower or rule is read. The TypeScript reference
 * card the Rust card is checked against lives in `src/tests/diagnostics/`.
 * Additional report categories without port reads are tracked by #1420.
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

/** A unit with no service facts adds no lines. */
const NO_SERVICE_LINES: SupplementalLines = Object.freeze({ lines: [], trailing: [] });

export function createCardKit(app: { readonly enginePort: EnginePort; readonly reader: ViewReader }): CardKit {
  const port = app.enginePort;
  const codes = new PortCodes(port);
  const cards = new Cards(app.enginePort, app.reader);
  const tenantParts = createPortUnitParts(port, (id) => {
    const facts = port.serviceDiagnostics(id);
    return facts ? portServiceSections(facts) : NO_SERVICE_LINES;
  });
  // The editor's 160ms UI refresh must not run the Rust engine's full
  // congestion attribution each time. This keeps only the last unit's
  // engine-authored explanation. Its key follows the same per-hour and
  // per-revision contract as the inspector's demand memo, plus the current
  // unit card, population and stars. A user command explicitly requests a
  // fresh reading; a notice countdown stays live, minute by minute.
  let diagnosticCache: { id: number; key: string; parts: PortUnitParts } | undefined;
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
    // Recycling fill can change between hours, so these lines are never
    // stored; each read puts them between the kept halves, after the lobby
    // advice and above any gripe or notice.
    const recycling = u.kind === "recycling" && !INERT_STATES.has(u.state)
      ? () => recyclingLinesOf(header.population, port.recyclingCapacity(), port.recyclingFill(), port.recyclingDemandMet())
      : undefined;
    // The notice deadline counts down minute by minute while the key moves
    // hourly, so a card with a notice is read whole each time. Only a
    // hand-edited save can put a recycling center on notice.
    if (u.state === "vacating") {
      diagnosticCache = undefined;
      return joinParts(tenantParts(id), recycling);
    }
    let parts: PortUnitParts;
    if (!fresh && diagnosticCache?.id === id && diagnosticCache.key === key) {
      parts = diagnosticCache.parts;
    } else {
      parts = tenantParts(id);
      diagnosticCache = { id, key, parts };
    }
    return joinParts(parts, recycling);
  };
  return {
    cards,
    catalog: () => catalogOf(app),
    diagnostics: {
      invalidate: () => { diagnosticCache = undefined; },
      unit: (id, fresh = false) => portUnitLines(id, fresh),
      transport: (id) => {
        const shaft = cards.shaft(id);
        return transportLoadLines(shaft?.utilization, shaft?.nearCapacity === true);
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
