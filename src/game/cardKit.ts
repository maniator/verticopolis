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
import { facilityDiagnostics, transportDiagnostics } from "./facilityDiagnostics";
import { recyclingLinesOf } from "./recyclingDiagnostics";
import { createPortUnitDiagnostics } from "./portUnitDiagnostics";

/**
 * What the facility editor and the inspector cards read: the decoded cards,
 * a shaft's schedule (`shaftSchedule`) and the batch dialog's dry run
 * (`quoteRentBatch`) through the port, the catalog of the engine the game
 * holds (`catalogOf`), and the cards' gripe lines (`facilityDiagnostics`),
 * which read the TypeScript engine's tower. The Rust engine's cards carry the
 * recycling lines off the port; the other lines are empty there until the port
 * carries them (#1420).
 */
export interface CardKit {
  readonly cards: Cards;
  catalog(): Catalog;
  readonly diagnostics: {
    unit(id: number): TemplateResult[];
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
  // The gripe lines read the TypeScript engine's own tower, never the
  // tooling's copy of the Rust engine's (`game.sim`), which a read would
  // rebuild from a save; the Rust engine shows only the lines the port carries
  // (#1420).
  const tsTower = (): Simulation | undefined => (app.enginePort as { readonly sim?: Simulation }).sim;
  const cards = new Cards(app.enginePort, app.reader);
  const tenantLines = createPortUnitDiagnostics(port);
  /** A recycling center's lines from the port: the card's kind and state, the
   *  population from the header, the capacity and the bin fill. Read when the
   *  card opens, not per frame. */
  const portUnitLines = (id: number): TemplateResult[] => {
    const u = cards.unit(id);
    if (!u) return [];
    const lines = tenantLines(id);
    if (u.kind === "recycling" && !INERT_STATES.has(u.state)) {
      lines.push(...recyclingLinesOf(app.reader.header.population, port.recyclingCapacity(), port.recyclingFill()));
    }
    return lines;
  };
  return {
    cards,
    catalog: () => catalogOf(app),
    diagnostics: {
      unit: (id) => {
        const sim = tsTower();
        if (!sim) return portUnitLines(id);
        const u = sim.tower.getUnit(id);
        return u ? facilityDiagnostics(sim, u) : [];
      },
      transport: (id) => {
        const sim = tsTower();
        const t = sim?.tower.getTransport(id);
        return sim && t ? transportDiagnostics(sim, t) : [];
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
