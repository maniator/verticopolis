import type { TemplateResult } from "lit-html";
import type { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { towerCatalog } from "../engine/towerCatalog";
import type { Transport, Unit } from "../engine/types";
import { clockOf } from "../simport/headerClock";
import { PortCodes } from "../simport/portCodes";
import { ViewReader } from "../simport/viewReader";
import { unitEditorTemplate, transportEditorTemplate } from "../ui/templates/editor";
import { unitInspectorTemplate, transportInspectorTemplate } from "../ui/templates/inspector";
import { createCardKit, type CardKit } from "./cardKit";
import type { EditorActionsDeps } from "./editorActions";
import type { InspectorDeps } from "./inspector";

/**
 * Test setup for the cards: a `TsEngine` over `sim`, the shared reader and
 * the card kit, built fresh on each call, so a test can change the
 * simulation and render again. The four helpers take what the templates took
 * before the port (a simulation and the unit or shaft) and render through the
 * cards.
 */
export function kitOf(sim: Simulation): { kit: CardKit; engine: TsEngine; reader: ViewReader } {
  const engine = new TsEngine(sim);
  const reader = new ViewReader(engine);
  return { kit: createCardKit({ enginePort: engine, reader, sim }), engine, reader };
}

export function unitEditor(sim: Simulation, u: Pick<Unit, "id">, mobile = false): TemplateResult {
  const { kit, reader } = kitOf(sim);
  return unitEditorTemplate(kit.cards.unit(u.id)!, towerCatalog(sim), clockOf(reader.header).hour, mobile, mobile ? kit.diagnostics.unit(u.id) : []);
}

export function transportEditor(sim: Simulation, t: Pick<Transport, "id">, mobile = false): TemplateResult {
  const { kit } = kitOf(sim);
  return transportEditorTemplate(kit.cards.shaft(t.id)!, towerCatalog(sim), mobile ? kit.diagnostics.transport(t.id) : []);
}

export function unitInspector(sim: Simulation, u: Pick<Unit, "id">): TemplateResult {
  const { kit, reader } = kitOf(sim);
  return unitInspectorTemplate(kit.cards.unit(u.id)!, towerCatalog(sim), clockOf(reader.header).hour, kit.diagnostics.unit(u.id));
}

export function transportInspector(sim: Simulation, t: Pick<Transport, "id">): TemplateResult {
  const { kit } = kitOf(sim);
  return transportInspectorTemplate(kit.cards.shaft(t.id)!, towerCatalog(sim), kit.diagnostics.transport(t.id));
}

/** The port getters `EditorActions` takes, over one engine for the test's life
 *  (the simulation it wraps is the test's own, mutated directly). */
export function editorPortDeps(sim: Simulation): Pick<EditorActionsDeps, "engine" | "codes" | "reader" | "kit"> & { tsEngine: TsEngine; viewReader: ViewReader } {
  const { kit, engine, reader } = kitOf(sim);
  const codes = new PortCodes(engine);
  return { engine: () => engine, codes: () => codes, reader: () => reader, kit: () => kit, tsEngine: engine, viewReader: reader };
}

/** The getters `InspectorController` takes. */
export function inspectorPortDeps(sim: Simulation): Pick<InspectorDeps, "kit" | "reader"> {
  const { kit, reader } = kitOf(sim);
  return { kit: () => kit, reader: () => reader };
}
