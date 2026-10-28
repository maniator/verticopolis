import type { TemplateResult } from "lit-html";
import type { Simulation } from "../engine/Simulation";
import type { Catalog } from "../engine/catalogTypes";
import type { ElevatorSchedule } from "../engine/elevatorSchedule";
import type { BatchRentOptions, BatchRentResult, BatchTarget } from "../engine/sim/constants";
import type { FacilityKind } from "../engine/types";
import { catalogOf } from "./portAccess";
import { Cards } from "../simport/cards";
import type { EnginePort } from "../simport/enginePort";
import type { ViewReader } from "../simport/viewReader";
import { facilityDiagnostics, transportDiagnostics } from "./facilityDiagnostics";

/**
 * What the facility editor and the inspector cards read besides the port: the
 * decoded cards, and the four reads the port has no member for yet. Each of
 * those four is read per call (adoptSim swaps the instance), and is a gap
 * the PR lists:
 *
 * - `catalog`: the tower's price and size tables (`catalogOf`), which the
 *   catalog handle points at whichever engine runs the tower.
 * - `diagnostics`: the cards' gripe lines (`facilityDiagnostics`), which move
 *   when `unitFacts` reaches `TsEngine`.
 * - `currentSchedule`: a shaft's authored schedule, which no card slot carries.
 * - `previewRentBatch`: the batch dialog's dry run, which the port has no quote for.
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

export function createCardKit(app: { readonly enginePort: EnginePort; readonly reader: ViewReader; readonly sim: Simulation }): CardKit {
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
    currentSchedule: (id) => app.sim.tower.getTransport(id)?.schedule,
    previewRentBatch: (kind, target, opts) => app.sim.previewRentBatch(kind, target, opts),
  };
}
