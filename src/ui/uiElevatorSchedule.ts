import type { UI } from "./UI";
import { render } from "lit-html";
import {
  elevatorScheduleTemplate,
  type FloorRow,
  type SchedCtx,
  type SchedState,
  type SchedHandlers,
} from "./templates/elevatorSchedule";
import { SCHEDULE_HOURS, type ElevatorSchedule, type ElevatorScheduleUX } from "../engine/elevatorSchedule";
import {
  presetSchedule,
  autoTuneSchedule,
  scheduleAdvice,
  stagingSummary,
  recommendedPreset,
  type ShaftContext,
  type SchedulePreset,
} from "../engine/scheduleAuthoring";

/**
 * The per-shaft elevator Schedule dialog controller (elevator-scheduling #305
 * Phase 3, floors fold-in #464), in the `showBatchPricingDialog` mold: a local
 * `state` working copy, a `recompute` that derives the advice and Simulate
 * readouts from the pure authoring model, and a `rerender` that lit-patches the
 * whole body. OK writes the SCHEDULE working copy through the supplied `apply`
 * (one `Tower.setSchedule`); Cancel discards it behind a two-press "Discard
 * changes?" arm once dirty (spec §8).
 *
 * The folded-in stops model is different on purpose: Serve toggles and the bulk
 * stop actions apply LIVE through the `stops` callbacks (each its own undo step,
 * exactly like the retired `Configure stops…` dialog), because stops change the
 * routing graph the tower runs on, not a private working copy. After every stop
 * edit the controller re-reads the live rows and re-snaps the working homes, so
 * the grid never shows a car homed on a skipped floor.
 */

export interface ScheduleStopsPort {
  /** The live span rows, DESCENDING (top first). Re-read after every toggle. */
  read(): FloorRow[];
  /** Toggle one floor's stop (its own undo step). No-op refusals are silent. */
  setServe(floor: number, serve: boolean): void;
  /** The bulk actions folded in from the editor card (standard/service only). */
  expressStops(): void;
  allStops(): void;
}

export interface ScheduleDialogCtx {
  title: string;
  ux: ElevatorScheduleUX;
  isExpress: boolean;
  cars: number;
  bottom: number;
  top: number;
  /** The live stops port (the folded-in `Configure stops…` model). */
  stops: ScheduleStopsPort;
  /** Measured 24-hour demand curve (0..1), or undefined if the shaft has not warmed up. */
  hourly?: readonly number[];
  /** The shaft's current authored schedule (the working copy is seeded from it). */
  current?: ElevatorSchedule;
  /** The live day type, so the dialog opens on the day the player is in. */
  initialWeekend: boolean;
  /** The a11y live-region channel for the pinned announce strings (spec §9). */
  announce?: (msg: string) => void;
}

const DEFAULT_SFD = 48; // the second-equivalent of the 0.8 game-minute dwell (DWELL_DEFAULT_SECONDS)

/** Sampled hours (nonzero slots) before the curve counts as measured. One busy hour
 *  must not arm Auto-tune and advice against 23 empty slots; the on-screen note
 *  promises "a day or two", so the gate waits for a real spread of the day. */
const WARMED_MIN_HOURS = 6;

export function showElevatorScheduleDialog(
  ui: UI,
  ctx: ScheduleDialogCtx,
  cb: { apply: (schedule: ElevatorSchedule) => void },
): void {
  // The measured curve arms the assists only once genuinely warmed; a cold curve is
  // withheld from the authoring model entirely, so advice and Auto-tune cannot read
  // a mostly-empty ring as a day of traffic.
  const warmed = !!ctx.hourly && ctx.hourly.filter((v) => v > 0).length >= WARMED_MIN_HOURS;

  const readFloors = (): FloorRow[] => ctx.stops.read();
  const servedFloorsAsc = (floors: FloorRow[]): number[] =>
    floors.filter((f) => f.served).map((f) => f.floor).sort((x, y) => x - y);
  const servedLobbiesAsc = (floors: FloorRow[]): number[] =>
    floors.filter((f) => f.served && f.lobby).map((f) => f.floor).sort((x, y) => x - y);
  const baseOf = (floors: FloorRow[]): number => servedLobbiesAsc(floors)[0] ?? ctx.bottom;

  /** The authoring-model view of the shaft, rebuilt from the LIVE rows so preset
   *  staging and the Simulate readout follow stop edits made inside the dialog. */
  const shaftNow = (floors: FloorRow[]): ShaftContext => ({
    cars: ctx.cars,
    bottom: ctx.bottom,
    top: ctx.top,
    servedLobbies: servedLobbiesAsc(floors),
    hourly: warmed ? ctx.hourly : undefined,
  });

  // A stored home floor may sit on a stop the shaft no longer serves: snap it to
  // the nearest served floor so the grid never marks a chip on a skipped row and
  // OK re-commits a floor the car can actually wait at.
  const snapToServed = (floor: number, served: number[]): number => {
    let bestFloor = served[0] ?? ctx.bottom;
    let bestDist = Infinity;
    for (const f of served) {
      const d = Math.abs(f - floor);
      if (d < bestDist) { bestDist = d; bestFloor = f; }
    }
    return bestFloor;
  };

  const initialFloors = readFloors();
  const initialServed = servedFloorsAsc(initialFloors);
  const base0 = baseOf(initialFloors);
  const fullRow = (): number[] => Array(SCHEDULE_HOURS).fill(ctx.cars);
  const seedRow = (r: readonly number[] | undefined): number[] => {
    const out = fullRow();
    if (r) for (let h = 0; h < SCHEDULE_HOURS; h++) if (Number.isFinite(r[h])) out[h] = Math.max(0, Math.min(ctx.cars, Math.floor(r[h])));
    return out;
  };
  const seedHomes = (): number[] =>
    Array.from({ length: ctx.cars }, (_, i) => {
      const v = ctx.current?.homeFloors?.[i];
      return typeof v === "number" && Number.isFinite(v) ? snapToServed(v, initialServed) : base0;
    });

  const state: SchedState = {
    day: ctx.initialWeekend ? "weekend" : "weekday",
    selectedHour: ctx.initialWeekend ? 12 : Math.min(17, SCHEDULE_HOURS - 1),
    rangeEnd: null,
    advancedOpen: false,
    cancelArmed: false,
    floors: initialFloors,
    base: base0,
    schedule: {
      activeCars: { weekday: seedRow(ctx.current?.activeCars?.weekday), weekend: seedRow(ctx.current?.activeCars?.weekend) },
      homeFloors: seedHomes(),
      waitingCarResponse: ctx.current?.waitingCarResponse ?? 0,
      standardFloorDeparture: ctx.current?.standardFloorDeparture ?? DEFAULT_SFD,
    },
    adviceMsg: "",
    simMsg: "",
  };
  // Whether the player (now, or in the stored schedule) has authored staging by hand;
  // presets keep their hands off hand-set homes, and Auto-tune seeds staging only
  // while this is false (spec §5.2/§14.3).
  let homesDirty = !!ctx.current?.homeFloors && ctx.current.homeFloors.length > 0;
  // Whether ANY schedule edit has landed since open: arms the Cancel discard guard.
  // Stop edits (Serve toggles) do NOT arm it: they applied live and Cancel cannot
  // take them back (each has its own undo step instead).
  let dirty = false;

  const sctx: SchedCtx = {
    title: ctx.title,
    ux: ctx.ux,
    isExpress: ctx.isExpress,
    cars: ctx.cars,
    hasMeasured: warmed,
    hourly: warmed ? ctx.hourly : undefined,
    recommended: recommendedPreset(ctx.isExpress),
  };

  const announce = (msg: string): void => ctx.announce?.(msg);
  // Compress an ascending hour list into ranges ("07:00–10:00, 13:00") so a
  // long advice stretch reads as one span, not a two-line comma flood (§11).
  const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;
  const fmtHours = (hs: number[]): string => {
    const parts: string[] = [];
    for (let i = 0; i < hs.length; ) {
      let j = i;
      while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
      parts.push(j > i ? `${hh(hs[i])}–${hh(hs[j])}` : hh(hs[i]));
      i = j + 1;
    }
    return parts.join(", ");
  };

  const recompute = (): void => {
    const isWeekend = state.day === "weekend";
    const shaft = shaftNow(state.floors);
    const adv = ctx.ux.advice ? scheduleAdvice(state.schedule, shaft, isWeekend) : null;
    if (!ctx.ux.advice) state.adviceMsg = "";
    else if (!adv) state.adviceMsg = sctx.hasMeasured ? "Measured demand and your schedule line up." : "";
    else {
      const parts: string[] = [];
      if (adv.over.length) parts.push(`over-staffed ${fmtHours(adv.over)}`);
      if (adv.short.length) parts.push(`short at ${fmtHours(adv.short)}`);
      state.adviceMsg = `This shaft is ${parts.join(" and ")} on ${state.day}s.`;
    }
    // The Simulate sentence leads with the staging clause, the axis that responds
    // to skill; the on-shift count trails. The base clause names its floor when
    // the base is not the ground lobby (a sky-lobby shaft's "at the lobby" would
    // read as a place it never touches; party ruling, spec §16).
    const sum = stagingSummary(state.schedule, shaft, isWeekend);
    const baseClause = state.base === 1 ? "at the lobby" : `at Floor ${state.base} (the base)`;
    state.simMsg =
      `Busiest ${state.day} hour ${hh(sum.peakHour)}: ${sum.upTowerCars} staged up-tower, ` +
      `${sum.lobbyCars} ${baseClause}, ${sum.activeAtPeak} of ${ctx.cars} cars on shift.`;
  };

  function rerender(): void {
    render(elevatorScheduleTemplate(sctx, state, handlers), box);
  }
  /** A schedule edit landed: mark dirty, disarm a pending discard, recompute, repaint. */
  const after = (): void => {
    dirty = true;
    state.cancelArmed = false;
    recompute();
    rerender();
  };
  /** A stop edit landed (applied live): refresh rows, re-derive the base, re-snap
   *  the working homes onto the new served set, recompute, repaint. */
  const afterStops = (): void => {
    state.floors = readFloors();
    state.base = baseOf(state.floors);
    const served = servedFloorsAsc(state.floors);
    state.schedule.homeFloors = state.schedule.homeFloors.map((f) => snapToServed(f, served));
    state.cancelArmed = false;
    recompute();
    rerender();
  };
  const curRow = (): number[] => (state.day === "weekend" ? state.schedule.activeCars.weekend! : state.schedule.activeCars.weekday!);
  /** The ascending inclusive hour span the docked stepper edits. */
  const span = (): [number, number] => {
    const a = state.selectedHour;
    const b = state.rangeEnd ?? a;
    return a <= b ? [a, b] : [b, a];
  };
  const focusBar = (h: number): void => {
    box.querySelectorAll<HTMLButtonElement>(".es-bar")[h]?.focus();
  };
  // On touch, a second tap on another bar EXTENDS the selection to a span (spec
  // §8: shift is not a phone key); a third tap resets to the tapped bar. On fine
  // pointers a plain click always re-selects and shift-click extends.
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  const handlers: SchedHandlers = {
    onDay: (day) => {
      state.day = day;
      state.rangeEnd = null;
      state.cancelArmed = false;
      recompute();
      rerender();
    },
    onSelectHour: (h, extend) => {
      const tapExtend = coarse && state.rangeEnd === null && h !== state.selectedHour;
      if (extend || tapExtend) state.rangeEnd = h;
      else {
        state.selectedHour = h;
        state.rangeEnd = null;
      }
      rerender();
    },
    onBarKey: (h, key) => {
      // The slider contract the bars announce (role="slider"): arrows adjust and
      // navigate from the keyboard (spec §9, §14.3).
      if (key === "ArrowUp" || key === "ArrowDown") {
        state.selectedHour = h;
        state.rangeEnd = null;
        const r = curRow();
        const dir = key === "ArrowUp" ? 1 : -1;
        r[h] = Math.max(0, Math.min(ctx.cars, (r[h] ?? ctx.cars) + dir));
        after();
        focusBar(h);
      } else if (key === "ArrowLeft" || key === "ArrowRight") {
        const nh = Math.max(0, Math.min(SCHEDULE_HOURS - 1, h + (key === "ArrowRight" ? 1 : -1)));
        state.selectedHour = nh;
        state.rangeEnd = null;
        rerender();
        focusBar(nh);
      }
    },
    onHourStep: (dir) => {
      const r = curRow();
      const [a, b] = span();
      for (let h = a; h <= b; h++) r[h] = Math.max(0, Math.min(ctx.cars, (r[h] ?? ctx.cars) + dir));
      after();
    },
    onWcrStep: (dir) => {
      const wcr = Math.max(0, Math.min(30, state.schedule.waitingCarResponse + dir));
      state.schedule.waitingCarResponse = wcr;
      announce(wcr === 0 ? "Waiting Car Response: 0. Idle cars answer the nearest call." : `Waiting Car Response set to ${wcr}. Higher holds idle cars in place longer.`);
      after();
    },
    onSfdStep: (dir) => {
      const sfd = Math.max(0, Math.min(60, state.schedule.standardFloorDeparture + dir * 2));
      state.schedule.standardFloorDeparture = sfd;
      announce(`Standard Floor Departure: ${sfd} seconds.`);
      after();
    },
    onServe: (floor, serve) => {
      ctx.stops.setServe(floor, serve);
      announce(serve ? `Floor ${floor} served.` : `Floor ${floor} skipped.`);
      afterStops();
    },
    onExpressStops: () => {
      ctx.stops.expressStops();
      announce("Stops set to lobbies only.");
      afterStops();
    },
    onAllStops: () => {
      ctx.stops.allStops();
      announce("Stopping at every floor.");
      afterStops();
    },
    onHomeSet: (car, floor) => {
      state.schedule.homeFloors[car] = floor;
      homesDirty = true;
      after();
    },
    onHomeAllBase: () => {
      state.schedule.homeFloors = state.schedule.homeFloors.map(() => state.base);
      homesDirty = true;
      after();
    },
    onStageUpTower: () => {
      const preset = presetSchedule("rush", shaftNow(state.floors)); // its split staging is the one-press play
      if (preset.homeFloors) state.schedule.homeFloors = [...preset.homeFloors];
      homesDirty = true;
      after();
    },
    onPreset: (p: SchedulePreset) => {
      const preset = presetSchedule(p, shaftNow(state.floors));
      state.schedule.activeCars = {
        weekday: preset.activeCars?.weekday ? [...preset.activeCars.weekday] : fullRow(),
        weekend: preset.activeCars?.weekend ? [...preset.activeCars.weekend] : fullRow(),
      };
      // A preset re-stages only staging the player has not hand-set (spec §14.3):
      // counts are its business, a hand-placed fleet is not.
      if (!homesDirty && preset.homeFloors) state.schedule.homeFloors = [...preset.homeFloors];
      announce(`Applied the ${p === "rush" ? "Rush" : p === "balanced" ? "Balanced" : "Feeder"} schedule.`);
      after();
    },
    onAutoTune: () => {
      // Hand the model an "unauthored homes" copy while the player has not touched
      // staging, so the documented seed branch is reachable from the dialog.
      const probe: ElevatorSchedule = { ...state.schedule, homeFloors: homesDirty ? state.schedule.homeFloors : undefined };
      const tuned = autoTuneSchedule(probe, shaftNow(state.floors));
      if (tuned) {
        state.schedule.activeCars = {
          weekday: tuned.activeCars?.weekday ? [...tuned.activeCars.weekday] : [...curRow()],
          weekend: tuned.activeCars?.weekend ? [...tuned.activeCars.weekend] : [...curRow()],
        };
        if (tuned.homeFloors) state.schedule.homeFloors = [...tuned.homeFloors];
      }
      announce("Auto-tuned cars and staging to this shaft's measured demand.");
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
    onCancel: () => {
      // A dirty working copy takes two presses: the first arms "Discard changes?",
      // any edit disarms (spec §8). Every dismissal path funnels here (see below).
      if (dirty && !state.cancelArmed) {
        state.cancelArmed = true;
        rerender();
        return;
      }
      ui.closeModal();
    },
  };

  recompute();
  // Advice about strip numbers should not critique a hidden strip: when the dialog
  // opens with a real advice sentence, the Advanced fold starts open (party flag).
  if (!ctx.ux.rawGridDefault && ctx.ux.advice && state.adviceMsg && state.adviceMsg.startsWith("This shaft is")) {
    state.advancedOpen = true;
  }
  const box = ui.openModalTemplate(elevatorScheduleTemplate(sctx, state, handlers));
  // The dirty guard must cover EVERY dismissal, not just the Cancel button: Esc and
  // the title-bar ✕ arrive as the dialog's cancelable "cancel" event, a backdrop
  // click as a click on the dialog element itself. finishModal re-sets both
  // handlers fresh on every open, so overriding them here cannot leak into other
  // dialogs; preventDefault holds the native Esc close while the confirm arms.
  const dlg = box.closest("dialog");
  if (dlg instanceof HTMLDialogElement) {
    dlg.oncancel = (e) => {
      if (dirty && !state.cancelArmed) e.preventDefault();
      handlers.onCancel();
    };
    dlg.onclick = (e) => {
      if (e.target === dlg) handlers.onCancel();
    };
  }
}
