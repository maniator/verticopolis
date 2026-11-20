import type { WasmEngine } from "@verticopolis/engine/binding/binding";
import type { UnitState } from "@verticopolis/engine/model/types";

/** The tooling setters (binding tier 3) a test reaches mid-run. Each that
 *  can refuse answers false, changing nothing. */
export interface ToolingSetters {
  setUnitState(id: number, state: UnitState, occupants?: number): boolean;
  setCustomersIn(id: number, count: number): boolean;
  startFireAt(id: number): boolean;
}

/** The setters: the binding's tooling members, one to one. */
export function rustTooling(engine: WasmEngine): ToolingSetters {
  return {
    setUnitState: (id, state, occupants) => engine.setUnitState(id, state, occupants),
    setCustomersIn: (id, count) => engine.setCustomersIn(id, count),
    startFireAt: (id) => engine.startFireAt(id),
  };
}
