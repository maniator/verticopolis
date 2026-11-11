import type { HourlyByDay } from "../../shared/engineTypes";
import { scheduleSlots } from "../../simport/scheduleSlots";
import type { ScheduleDialogCtx } from "../../ui/uiElevatorSchedule";
import { telemetryDocument } from "../../wasmhost/telemetry";
import { wasm } from "../conformance/wasmEngine";

type DoubleCtx = Pick<ScheduleDialogCtx, "cars" | "bottom" | "top" | "stops" | "origins" | "isExpress"> & {
  /** The shaft's measured curves, as the engine would hold them. */
  hourly?: { weekday?: readonly number[]; weekend?: readonly number[] };
};

/** The binding calls the double makes. */
type ScheduleEngine = Pick<ReturnType<typeof wasm>["Engine"]["prototype"], "autoTuneProposal" | "scheduleFacts" | "schedulePreset"> & {
  setMoney(amount: number): void;
  placeBare(kind: string, floor: number, x: number): string;
  placeTransportBare(kind: string, x: number, bottom: number, top: number): string;
  setCars(id: number, cars: number): boolean;
  markStop(id: number, floor: number, stop: boolean): Float64Array;
  seedElevatorTelemetry(json: string): void;
  lastReason(): string | undefined;
};

/** The width of the stand-in tower's floors, and the shaft's column. */
const TOWER_WIDTH = 10;
const SHAFT_X = 2;
/** Floors a lobby may stand on besides the ground floor: every 15th, as the
 *  engine's catalog (`world.lobbyInterval`) has it. */
const LOBBY_INTERVAL = 15;
const GROUND_FLOOR = 1;
const HOURS = 24;

/** Built towers by what they were built from, so a dialog that asks again
 *  with nothing changed reuses its engine. */
const built = new Map<string, { engine: ScheduleEngine; id: number }>();

const placed = (text: string, what: string): number => {
  const r = JSON.parse(text) as { ok: boolean; reason?: string; unitId?: number; transportId?: number };
  if (!r.ok) throw new Error(`the schedule double could not place ${what}: ${r.reason}`);
  return r.transportId ?? r.unitId ?? 0;
};

const curve = (row: readonly number[] | undefined): number[] => Array.from({ length: HOURS }, (_, h) => row?.[h] ?? 0);

/** A Rust engine holding one shaft shaped like the dialog's: its span, cars,
 *  kind, served floors, lobbies (where a lobby may stand) and measured
 *  telemetry. */
function shaftEngine(ctx: DoubleCtx, modern: boolean): { engine: ScheduleEngine; id: number } {
  const rows = ctx.stops.read();
  const hourly: HourlyByDay | undefined = ctx.hourly && { weekday: curve(ctx.hourly.weekday), weekend: curve(ctx.hourly.weekend) };
  const key = JSON.stringify({
    modern,
    cars: ctx.cars,
    bottom: ctx.bottom,
    top: ctx.top,
    express: ctx.isExpress,
    rows,
    hourly,
    origins: ctx.origins && { weekday: ctx.origins.weekday.map((m) => [...m]), weekend: ctx.origins.weekend.map((m) => [...m]) },
  });
  const hit = built.get(key);
  if (hit) return hit;
  const engine = wasm().Engine.newGame(1, modern ? "modern" : "classic") as unknown as ScheduleEngine;
  engine.setMoney(1e12);
  const lobbies = new Set(rows.filter((r) => r.lobby).map((r) => r.floor));
  for (let floor = ctx.bottom; floor <= ctx.top; floor++) {
    const lobby = floor === GROUND_FLOOR || (lobbies.has(floor) && floor % LOBBY_INTERVAL === 0);
    for (let x = 0; x < TOWER_WIDTH; x++) placed(engine.placeBare(lobby ? "lobby" : "floor", floor, x), `floor ${floor}`);
  }
  const kind = ctx.isExpress ? "elevatorExpress" : "elevatorStandard";
  const id = placed(engine.placeTransportBare(kind, SHAFT_X, ctx.bottom, ctx.top), kind);
  if (!engine.setCars(id, ctx.cars)) throw new Error(`the schedule double could not set ${ctx.cars} cars: ${engine.lastReason()}`);
  for (const r of rows) engine.markStop(id, r.floor, r.served);
  const stores = {
    elevatorUtil: new Map<number, number>(),
    elevatorHourly: new Map(hourly ? [[id, hourly]] : []),
    elevatorOrigins: new Map(ctx.origins ? [[id, ctx.origins]] : []),
  };
  engine.seedElevatorTelemetry(JSON.stringify(telemetryDocument(stores)));
  const made = { engine, id };
  built.set(key, made);
  return made;
}

/**
 * The schedule dialog's engine queries (Auto-tune, the advice and staging
 * facts, the presets) answered by the Rust engine, for the dialog suites that
 * hand the dialog fake stops and curves instead of a tower. Each question is
 * asked of a real engine holding one shaft shaped like the fakes (read live,
 * so a stop edit the dialog makes is seen), the same way the game asks
 * (`editorActions.ts`). What the answers are is pinned in Rust
 * (`schedule_authoring_tests`, `schedule_facts_tests`, `schedule_presets_tests`);
 * here the dialog is shown to use them.
 */
export function rustScheduleEngine(ctx: DoubleCtx, modern = true): Pick<ScheduleDialogCtx, "autoTune" | "facts" | "preset"> {
  return {
    autoTune: (draft, weekendView) => {
      const { engine, id } = shaftEngine(ctx, modern);
      return engine.autoTuneProposal(id, scheduleSlots(draft), weekendView);
    },
    facts: (draft, weekendView) => {
      const { engine, id } = shaftEngine(ctx, modern);
      return engine.scheduleFacts(id, scheduleSlots(draft), weekendView);
    },
    preset: (name) => {
      const { engine, id } = shaftEngine(ctx, modern);
      return engine.schedulePreset(id, name);
    },
  };
}
