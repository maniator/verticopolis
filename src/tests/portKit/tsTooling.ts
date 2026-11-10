import { Clock } from "../../engine/Clock";
import { syncAttendanceOccupants } from "../../engine/census";
import type { WasmEngine } from "../../dualrun/binding";
import type { TsEngine } from "../../engine/port/tsEngine";
import { markRoom, setRoomState } from "../../engine/tower/rooms";
import { isUnitState, isVacateReason, type UnitState, type VacateReason, type WeatherKind } from "../../engine/types";

/** The tooling setters (binding tier 3) a test reaches mid-run, the same on
 *  both engines. Each that can refuse answers false, changing nothing. */
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

/** The setters' bounds, the same on both legs (the Rust members in
 *  `exports_state.rs` carry the twins): the latest clock in minutes, and the
 *  states a bare write cannot make because the engine keeps a timer or an
 *  event record beside them. */
const MAX_TOOL_CLOCK_MINUTES = 1e9;
const NEEDS_ITS_OWN_RECORD: ReadonlySet<UnitState> = new Set(["construction", "fire"]);
const WEATHER_KINDS: ReadonlySet<string> = new Set<WeatherKind>(["clear", "cloudy", "rain"]);

/** The TypeScript leg's setters, with the same refusals as the Rust members,
 *  so a test fails alike on both. */
export function tsTooling(engine: TsEngine): ToolingSetters {
  const unitById = (id: number) => engine.sim.tower.units.find((u) => u.id === id);
  return {
    setClock: (minutes) => {
      if (!(minutes >= 0 && minutes <= MAX_TOOL_CLOCK_MINUTES)) return false;
      engine.sim.clock = new Clock(minutes, engine.sim.clock.calendar);
      return true;
    },
    setUnitState: (id, state, occupants) => {
      const unit = unitById(id);
      if (!unit || !isUnitState(state) || NEEDS_ITS_OWN_RECORD.has(state)) return false;
      if (occupants !== undefined && !(Number.isSafeInteger(occupants) && occupants >= 0)) return false;
      setRoomState(engine.sim.tower, unit, state);
      if (occupants !== undefined) {
        unit.occupants = occupants;
        markRoom(engine.sim.tower, unit);
      }
      return true;
    },
    setCustomersIn: (id, count) => {
      const unit = unitById(id);
      if (!unit || !(Number.isSafeInteger(count) && count >= 0)) return false;
      unit.customersIn = count + 0; // + 0 turns -0 into 0, as the Rust i64 cast does
      syncAttendanceOccupants(unit);
      markRoom(engine.sim.tower, unit);
      engine.sim.tower.bumpMealOverlayRevision();
      return true;
    },
    setWeather: (weather) => {
      if (!WEATHER_KINDS.has(weather)) return false;
      engine.sim.weather = weather;
      return true;
    },
    startFireAt: (id) => {
      const events = engine.sim.events;
      if (events.pending !== null || events.count > 0) return false;
      const unit = events.flammableUnits().find((u) => u.id === id);
      if (!unit) return false;
      events.startFireOn(unit);
      events.offerFireRescue();
      return true;
    },
    vacateUnit: (id, reason) => {
      const unit = unitById(id);
      if (!unit || !isVacateReason(reason)) return false;
      engine.sim.vacate(unit, reason);
      return true;
    },
    setUnitRent: (id, rent) => {
      const unit = unitById(id);
      if (!unit || (rent !== null && !(Number.isFinite(rent) && rent >= 0))) return false;
      unit.rent = rent ?? undefined;
      markRoom(engine.sim.tower, unit);
      return true;
    },
    clearRetailTallies: () => {
      for (const u of engine.sim.tower.units) {
        u.patronageToday = undefined;
        u.patronageYest = undefined;
        u.profitToday = undefined;
        u.profitYest = undefined;
      }
    },
  };
}

/** The Rust leg's setters: the binding's tooling members, one to one. */
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
