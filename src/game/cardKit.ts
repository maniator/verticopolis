import type { TemplateResult } from "lit-html";
import type { Simulation } from "../engine/Simulation";
import type { Catalog } from "../engine/catalogTypes";
import type { ElevatorSchedule } from "../engine/elevatorSchedule";
import type { BatchRentOptions, BatchRentResult, BatchTarget } from "../engine/sim/constants";
import type { FacilityKind } from "../engine/types";
import { catalogOf } from "./portAccess";
import { Cards } from "../simport/cards";
import { PortCodes } from "../simport/portCodes";
import { scheduleFromSlots } from "../simport/scheduleSlots";
import type { EnginePort } from "../simport/enginePort";
import type { ViewReader } from "../simport/viewReader";
import { facilityDiagnostics, transportDiagnostics } from "./facilityDiagnostics";

/**
 * What the facility editor and the inspector cards read: the decoded cards,
 * a shaft's schedule (`shaftSchedule`) and the batch dialog's dry run
 * (`quoteRentBatch`) through the port, and two reads the port has no member
 * for yet. Each of those two is read per call (adoptSim swaps the instance),
 * and is a gap the PR lists:
 *
 * - `catalog`: the tower's price and size tables (`catalogOf`), which the
 *   catalog handle points at whichever engine runs the tower.
 * - `diagnostics`: the cards' gripe lines (`facilityDiagnostics`), which move
 *   when `unitFacts` reaches `TsEngine`.
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

export function createCardKit(app: { readonly enginePort: EnginePort; readonly reader: ViewReader; readonly sim: Simulation }): CardKit {
  const port = app.enginePort;
  const codes = new PortCodes(port);
  return {
    cards: new Cards(app.enginePort, app.reader),
    catalog: () => catalogOf(app),
    diagnostics: {
      unit: (id) => {
        const u = app.sim.tower.getUnit(id);
        return u ? facilityDiagnostics(app.sim, u) : [];
      },
      transport: (id) => {
        const t = app.sim.tower.getTransport(id);
        return t ? transportDiagnostics(app.sim, t) : [];
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
