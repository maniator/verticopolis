import type { WasmEngine } from "../../dualrun/binding";
import type { UnitState, VacateReason, WeatherKind } from "../../shared/types";

/** The tooling setters (binding tier 3) a test reaches mid-run. Each that
 *  can refuse answers false, changing nothing. */
export interface ToolingSetters {
  setClock(minutes: number): boolean;
  setUnitState(id: number, state: UnitState, occupants?: number): boolean;
  setCustomersIn(id: number, count: number): boolean;
  setWeather(weather: WeatherKind): boolean;
  clearRetailTallies(): void;
  startFireAt(id: number): boolean;
  vacateUnit(id: number, reason: VacateReason): boolean;
  setUnitRent(id: number, rent: number | null): boolean;
}

/** The setters: the binding's tooling members, one to one. */
export function rustTooling(engine: WasmEngine): ToolingSetters {
  return {
    setClock: (minutes) => engine.setClock(minutes),
    setUnitState: (id, state, occupants) => engine.setUnitState(id, state, occupants),
    setCustomersIn: (id, count) => engine.setCustomersIn(id, count),
    setWeather: (weather) => engine.setWeather(weather),
    clearRetailTallies: () => engine.clearRetailTallies(),
    startFireAt: (id) => engine.startFireAt(id),
    vacateUnit: (id, reason) => engine.vacateUnit(id, reason),
    setUnitRent: (id, rent) => engine.setUnitRent(id, rent),
  };
}
