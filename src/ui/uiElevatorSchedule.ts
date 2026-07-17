import type { UI } from "./UI";
import { render } from "lit-html";
import {
  elevatorScheduleTemplate,
  type SchedCtx,
  type SchedState,
  type SchedHandlers,
} from "./templates/elevatorSchedule";
import type { ElevatorSchedule } from "../engine/elevatorSchedule";
import { SCHEDULE_HOURS } from "../engine/elevatorSchedule";
import {
  presetSchedule,
  autoTuneSchedule,
  scheduleAdvice,
  stagingSummary,
  recommendedPreset,
  type ShaftContext,
  type SchedulePreset,
} from "../engine/scheduleAuthoring";
import type { ElevatorScheduleUX } from "../engine/gameRules";
import { syncRungSelects } from "./templates/rungPicker";

/**
 * The per-shaft elevator Schedule dialog controller (elevator-scheduling #305 Phase 3),
 * in the `showBatchPricingDialog` mold: a local `state` working copy, a `recompute` that
 * derives the advice and Simulate readouts from the pure authoring model, and a
 * `rerender` that lit-patches the whole body. OK writes the working copy through the
 * supplied `apply` (a single `Tower.setSchedule`); Cancel discards it.
 *
 * Positioning-first (spec §14): the readouts score staging, and Auto-tune / presets seed
 * positioning, not thrift. The dialog is mode-agnostic; only the affordances differ, via
 * the `elevatorScheduleUX` flags passed in.
 */

export interface ScheduleDialogCtx {
  title: string;
  ux: ElevatorScheduleUX;
  isExpress: boolean;
  cars: number;
  bottom: number;
  top: number;
  /** Served floors carrying a (sky) lobby, ascending. The preset staging targets. */
  servedLobbies: number[];
  /** All served floors, ascending. The per-car home-floor choices. */
  servedFloors: number[];
  /** Measured 24-hour demand curve (0..1), or undefined if the shaft has not warmed up. */
  hourly?: readonly number[];
  /** The shaft's current authored schedule (the working copy is seeded from it). */
  current?: ElevatorSchedule;
  /** The live day type, so the dialog opens on the day the player is in. */
  initialWeekend: boolean;
}

const DEFAULT_SFD = 48; // the second-equivalent of the 0.8 game-minute dwell (DWELL_DEFAULT_SECONDS)

export function showElevatorScheduleDialog(
  ui: UI,
  ctx: ScheduleDialogCtx,
  cb: { apply: (schedule: ElevatorSchedule) => void },
): void {
  const shaft: ShaftContext = {
    cars: ctx.cars,
    bottom: ctx.bottom,
    top: ctx.top,
    servedLobbies: ctx.servedLobbies,
    hourly: ctx.hourly,
  };
  const base = ctx.servedLobbies[0] ?? ctx.bottom;
  const fullRow = (): number[] => Array(SCHEDULE_HOURS).fill(ctx.cars);
  const seedRow = (r: readonly number[] | undefined): number[] => {
    const out = fullRow();
    if (r) for (let h = 0; h < SCHEDULE_HOURS; h++) if (Number.isFinite(r[h])) out[h] = Math.max(0, Math.min(ctx.cars, Math.floor(r[h])));
    return out;
  };
  const seedHomes = (): number[] =>
    Array.from({ length: ctx.cars }, (_, i) => {
      const v = ctx.current?.homeFloors?.[i];
      return typeof v === "number" && Number.isFinite(v) ? v : base;
    });

  const state: SchedState = {
    day: ctx.initialWeekend ? "weekend" : "weekday",
    selectedHour: ctx.initialWeekend ? 12 : Math.min(17, SCHEDULE_HOURS - 1),
    advancedOpen: false,
    schedule: {
      activeCars: { weekday: seedRow(ctx.current?.activeCars?.weekday), weekend: seedRow(ctx.current?.activeCars?.weekend) },
      homeFloors: seedHomes(),
      waitingCarResponse: ctx.current?.waitingCarResponse ?? 0,
      standardFloorDeparture: ctx.current?.standardFloorDeparture ?? DEFAULT_SFD,
    },
    adviceMsg: "",
    simMsg: "",
  };

  const sctx: SchedCtx = {
    title: ctx.title,
    ux: ctx.ux,
    isExpress: ctx.isExpress,
    cars: ctx.cars,
    servedLobbies: ctx.servedLobbies,
    servedFloors: ctx.servedFloors,
    hasMeasured: !!ctx.hourly && ctx.hourly.some((v) => v > 0),
    recommended: recommendedPreset(ctx.isExpress),
  };

  const fmtHours = (hs: number[]): string => hs.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ");

  const recompute = (): void => {
    const isWeekend = state.day === "weekend";
    const adv = ctx.ux.advice ? scheduleAdvice(state.schedule, shaft, isWeekend) : null;
    if (!adv) state.adviceMsg = sctx.hasMeasured ? "Measured demand and your schedule line up." : "";
    else {
      const parts: string[] = [];
      if (adv.over.length) parts.push(`over-staffed ${fmtHours(adv.over)}`);
      if (adv.short.length) parts.push(`short at ${fmtHours(adv.short)}`);
      state.adviceMsg = `This shaft is ${parts.join(" and ")} on ${state.day}s.`;
    }
    const sum = stagingSummary(state.schedule, shaft, isWeekend);
    const hh = `${String(sum.peakHour).padStart(2, "0")}:00`;
    state.simMsg =
      `Busiest ${state.day} hour ${hh}: ${sum.activeAtPeak} of ${ctx.cars} cars, ` +
      `${sum.upTowerCars} staged up-tower, ${sum.lobbyCars} at the lobby.`;
  };

  function rerender(): void {
    render(elevatorScheduleTemplate(sctx, state, handlers), box);
    // Post-render selection write for the home-floor selects (see rungPicker.ts:
    // options must be attached before a select's value can be set reliably).
    syncRungSelects(box);
  }
  const after = (): void => {
    recompute();
    rerender();
  };
  const curRow = (): number[] => (state.day === "weekend" ? state.schedule.activeCars.weekend! : state.schedule.activeCars.weekday!);

  const handlers: SchedHandlers = {
    onDay: (day) => {
      state.day = day;
      after();
    },
    onSelectHour: (h) => {
      state.selectedHour = h;
      rerender();
    },
    onHourStep: (dir) => {
      const r = curRow();
      r[state.selectedHour] = Math.max(0, Math.min(ctx.cars, (r[state.selectedHour] ?? ctx.cars) + dir));
      after();
    },
    onWcrStep: (dir) => {
      state.schedule.waitingCarResponse = Math.max(0, Math.min(30, state.schedule.waitingCarResponse + dir));
      after();
    },
    onSfdStep: (dir) => {
      state.schedule.standardFloorDeparture = Math.max(0, Math.min(60, state.schedule.standardFloorDeparture + dir * 2));
      after();
    },
    onHomeSet: (car, floor) => {
      state.schedule.homeFloors[car] = floor;
      after();
    },
    onHomeAllBase: () => {
      state.schedule.homeFloors = state.schedule.homeFloors.map(() => base);
      after();
    },
    onStageUpTower: () => {
      const preset = presetSchedule("rush", shaft); // its split staging is the one-press play
      if (preset.homeFloors) state.schedule.homeFloors = [...preset.homeFloors];
      after();
    },
    onPreset: (p: SchedulePreset) => {
      const preset = presetSchedule(p, shaft);
      state.schedule.activeCars = {
        weekday: preset.activeCars?.weekday ? [...preset.activeCars.weekday] : fullRow(),
        weekend: preset.activeCars?.weekend ? [...preset.activeCars.weekend] : fullRow(),
      };
      if (preset.homeFloors) state.schedule.homeFloors = [...preset.homeFloors];
      after();
    },
    onAutoTune: () => {
      const tuned = autoTuneSchedule(state.schedule, shaft);
      if (tuned) {
        state.schedule.activeCars = {
          weekday: tuned.activeCars?.weekday ? [...tuned.activeCars.weekday] : curRow(),
          weekend: tuned.activeCars?.weekend ? [...tuned.activeCars.weekend] : curRow(),
        };
        if (tuned.homeFloors) state.schedule.homeFloors = [...tuned.homeFloors];
      }
      after();
    },
    onToggleAdvanced: () => {
      state.advancedOpen = !state.advancedOpen;
      rerender();
    },
    onOk: () => {
      cb.apply({
        activeCars: {
          weekday: [...state.schedule.activeCars.weekday!],
          weekend: [...state.schedule.activeCars.weekend!],
        },
        waitingCarResponse: state.schedule.waitingCarResponse,
        standardFloorDeparture: state.schedule.standardFloorDeparture,
        homeFloors: [...state.schedule.homeFloors],
      });
      ui.closeModal();
    },
    onCancel: () => ui.closeModal(),
  };

  recompute();
  const box = ui.openModalTemplate(elevatorScheduleTemplate(sctx, state, handlers));
  syncRungSelects(box); // initial selection, post-attach (see rungPicker.ts)
}
