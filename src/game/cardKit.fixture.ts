import type { TemplateResult } from "lit-html";
import type { Transport, Unit } from "../shared/types";
import type { EnginePort } from "../simport/enginePort";
import { clockOf } from "../simport/headerClock";
import { PortCodes } from "../simport/portCodes";
import type { ViewReader } from "../simport/viewReader";
import type { Draft } from "../tests/portKit/drafts";
import { unitEditorTemplate, transportEditorTemplate } from "../ui/templates/editor";
import { unitInspectorTemplate, transportInspectorTemplate } from "../ui/templates/inspector";
import { createCardKit, type CardKit } from "./cardKit";
import { catalogOf, newViewReader } from "./portAccess";
import type { EditorActionsDeps } from "./editorActions";
import type { InspectorDeps } from "./inspector";

/** The draft's engine, with every pending edit loaded into it. */
export function portOf(sim: Draft): EnginePort {
  sim.settle();
  return sim.port as unknown as EnginePort;
}

/**
 * Test setup for the cards: the draft's engine (the Rust engine), the shared
 * reader and the card kit, built fresh on each call, so a test can change the
 * draft and render again. The four helpers take a draft and the unit or shaft
 * and render through the cards.
 */
export function kitOf(sim: Draft): { kit: CardKit; engine: EnginePort; reader: ViewReader } {
  const engine = portOf(sim);
  const reader = newViewReader(engine);
  return { kit: createCardKit({ enginePort: engine, reader }), engine, reader };
}

export function unitEditor(sim: Draft, u: Pick<Unit, "id">, mobile = false): TemplateResult {
  const { kit, engine, reader } = kitOf(sim);
  return unitEditorTemplate(kit.cards.unit(u.id)!, catalogOf({ enginePort: engine, reader }), clockOf(reader.header).hour, mobile, mobile ? kit.diagnostics.unit(u.id) : [], reader.header.modernCalendar);
}

export function transportEditor(sim: Draft, t: Pick<Transport, "id">, mobile = false): TemplateResult {
  const { kit, engine, reader } = kitOf(sim);
  return transportEditorTemplate(kit.cards.shaft(t.id)!, catalogOf({ enginePort: engine, reader }), mobile ? kit.diagnostics.transport(t.id) : []);
}

export function unitInspector(sim: Draft, u: Pick<Unit, "id">): TemplateResult {
  const { kit, engine, reader } = kitOf(sim);
  return unitInspectorTemplate(kit.cards.unit(u.id)!, catalogOf({ enginePort: engine, reader }), clockOf(reader.header).hour, kit.diagnostics.unit(u.id));
}

export function transportInspector(sim: Draft, t: Pick<Transport, "id">): TemplateResult {
  const { kit, engine, reader } = kitOf(sim);
  return transportInspectorTemplate(kit.cards.shaft(t.id)!, catalogOf({ enginePort: engine, reader }), kit.diagnostics.transport(t.id));
}

/** The port getters `EditorActions` takes, over the draft's engine for the
 *  test's life. Each getter loads the draft's pending edits; a test that
 *  edits the draft directly still updates the reader before a controller
 *  reads it. */
export function editorPortDeps(sim: Draft): Pick<EditorActionsDeps, "engine" | "codes" | "reader" | "kit"> & { port: EnginePort; viewReader: ViewReader } {
  const { kit, engine, reader } = kitOf(sim);
  const codes = new PortCodes(engine);
  // Each getter loads what the test changed on the draft first, as the app's
  // engine always holds the tower the player sees.
  return {
    engine: () => portOf(sim),
    codes: () => codes,
    reader: () => (portOf(sim), reader),
    kit: () => (portOf(sim), kit),
    port: engine,
    viewReader: reader,
  };
}

/** The getters `InspectorController` takes. */
export function inspectorPortDeps(sim: Draft): Pick<InspectorDeps, "kit" | "reader"> {
  const { kit, reader } = kitOf(sim);
  return { kit: () => kit, reader: () => reader };
}
