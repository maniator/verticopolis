import type { UI } from "./UI";
import { render } from "lit-html";
import { elevatorScheduleTemplate, floorLabel, type FloorRow, type SchedCtx, type SchedState, type SchedHandlers } from "./templates/elevatorSchedule";
import type { ElevatorSchedule } from "../shared/engineTypes";
import type { OriginRings } from "../shared/engineTypes";
import { SCHEDULE_HOURS } from "../simport/scheduleSlots";
import { hotspotFloors, type ElevatorScheduleUX } from "./scheduleDialogRules";
import type { AssistedPreset, AutoTuneProposal, PresetProposal, ScheduleFacts, SchedulePresetName } from "../simport/enginePort";
import { hh, fmtHours, originClause } from "./scheduleFormat";

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
  /** Toggle one floor's stop (its own undo step). No-op refusals are silent.
   *  Settles once the engine has answered; the dialog re-reads after that. */
  setServe(floor: number, serve: boolean): Promise<void>;
  /** The bulk actions folded in from the editor card (standard/service only). */
  expressStops(): Promise<void>;
  allStops(): Promise<void>;
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
  /** Per-floor boarding-origin rings (#465), day-split like `hourly`; feeds the
   *  grid's hotspot markers and the Simulate origin clause (the engine aims
   *  Auto-tune's staging from its own copy). */
  origins?: OriginRings;
  /** The engine's read-only Auto-tune proposal for this shaft against the
   *  dialog's working schedule (homes left out while the player has not staged
   *  by hand); `weekendView` is the day tab on screen. It owns which days are
   *  warm, whether Auto-tune is offered and what it proposes: the dialog only
   *  shows and applies the answer. */
  autoTune: (draft: ElevatorSchedule, weekendView: boolean) => AutoTuneProposal;
  /** The engine's advice and staging facts for this shaft against the working
   *  schedule (homes included: they are the staging being summarized). It owns
   *  the over and short hours, the busiest hour, the staging counts and which
   *  preset to highlight; the dialog words them. */
  facts: (draft: ElevatorSchedule, weekendView: boolean) => ScheduleFacts;
  /** The rows and homes a named preset sets for this shaft. Reads the engine's
   *  live stops, so it follows stop edits made inside the dialog. */
  preset: (name: SchedulePresetName) => PresetProposal;
  /** The shaft's current authored schedule (the working copy is seeded from it). */
  current?: ElevatorSchedule;
  /** The live day type, so the dialog opens on the day the player is in. */
  initialWeekend: boolean;
  /** The a11y live-region channel for the pinned announce strings (spec §9). */
  announce?: (msg: string) => void;
}

const DEFAULT_SFD = 48; // the second-equivalent of the 0.8 game-minute dwell (DWELL_DEFAULT_SECONDS)

/** Announcement-cased preset names for the applied-schedule toast. */
const PRESET_LABEL: Record<AssistedPreset, string> = {
  rush: "Rush",
  balanced: "Balanced",
  feeder: "Feeder",
};

export function showElevatorScheduleDialog(
  ui: UI,
  ctx: ScheduleDialogCtx,
  cb: { apply: (schedule: ElevatorSchedule) => Promise<void> },
): void {
  // The engine says which day's curve is warm (#1550), asked afresh on every
  // recompute so a day that warms while the dialog sits open is picked up. A
  // cold curve is withheld from the authoring model entirely, so advice cannot
  // read a mostly-empty ring as a day of traffic, and a warmed weekday never
  // stands in for an unmeasured weekend.
  let tune: AutoTuneProposal = ctx.autoTune({}, ctx.initialWeekend);
  // The same answer carries each warm day's measured curve (0..1 per hour of
  // day, #466), so the ghost and the advice draw the ring the engine tuned from.
  const warmedWd = (): boolean => tune.weekday.warm;
  const warmedWe = (): boolean => tune.weekend.warm;

  const readFloors = (): FloorRow[] => ctx.stops.read();
  const servedFloorsAsc = (floors: FloorRow[]): number[] =>
    floors.filter((f) => f.served).map((f) => f.floor).sort((x, y) => x - y);

  /** The visible day's origin map at hour `h`, gated on that day's warm demand
   *  curve so origins never outrun the demand gate (#465). */
  const dayOriginsAt = (h: number): ReadonlyMap<number, number> | undefined => {
    if (!ctx.origins || !dayWarmed()) return undefined;
    const ring = state.day === "weekend" ? ctx.origins.weekend : ctx.origins.weekday;
    return ring[((h % SCHEDULE_HOURS) + SCHEDULE_HOURS) % SCHEDULE_HOURS];
  };
  // A stored home floor may sit on a stop the shaft no longer serves. The
  // engine answers the homes it would hold (each on the nearest served floor, a
  // car with no home at the base lobby), so the grid never marks a chip on a
  // skipped row and OK re-commits a floor the car can actually wait at.
  const initialFloors = readFloors();
  const seed = ctx.facts({ homeFloors: ctx.current?.homeFloors ? [...ctx.current.homeFloors] : undefined }, ctx.initialWeekend);
  const base0 = seed.staging?.baseLobby ?? ctx.bottom;
  const fullRow = (): number[] => Array(SCHEDULE_HOURS).fill(ctx.cars);
  const seedRow = (r: readonly number[] | undefined): number[] => {
    const out = fullRow();
    if (r) for (let h = 0; h < SCHEDULE_HOURS; h++) if (Number.isFinite(r[h])) out[h] = Math.max(0, Math.min(ctx.cars, Math.floor(r[h])));
    return out;
  };
  // A refused seed query keeps the stored homes where they are readable; the
  // first recompute then asks again and the engine snaps them.
  const storedHome = (i: number): number => {
    const home = ctx.current?.homeFloors?.[i];
    return home !== undefined && Number.isFinite(home) ? home : base0;
  };
  const seedHomes = (): number[] => (seed.homeFloors.length === ctx.cars ? [...seed.homeFloors] : Array.from({ length: ctx.cars }, (_, i) => storedHome(i)));

  const state: SchedState = {
    day: ctx.initialWeekend ? "weekend" : "weekday",
    selectedHour: ctx.initialWeekend ? 12 : Math.min(17, SCHEDULE_HOURS - 1),
    rangeEnd: null,
    advancedOpen: false,
    cancelArmed: false,
    dirty: false,
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
    originFloors: [],
  };
  // Whether the player (now, or in the stored schedule) has authored staging by hand;
  // presets keep their hands off hand-set homes, and Auto-tune seeds staging only
  // while this is false (spec §5.2/§14.3).
  let homesDirty = !!ctx.current?.homeFloors && ctx.current.homeFloors.length > 0;
  // `state.dirty` (any schedule edit since open) arms the Cancel discard guard; stop
  // edits do not, since they applied live and each has its own undo step.
  let applying = false; // one OK per open, held while the engine answers
  // The template's `hourly`/`hasMeasured` are DAY-SCOPED (#466): the ghost and
  // the "line up" fallback follow the day tab, so an unmeasured weekend shows no
  // ghost even while the weekday curve is warm. `recompute` keeps them current.
  const dayWarmed = (): boolean => (state.day === "weekend" ? warmedWe() : warmedWd());
  const dayCurve = (): readonly number[] | undefined => {
    const day = state.day === "weekend" ? tune.weekend : tune.weekday;
    return day.curve ?? undefined;
  };

  const sctx: SchedCtx = {
    title: ctx.title,
    ux: ctx.ux,
    isExpress: ctx.isExpress,
    cars: ctx.cars,
    hasMeasured: dayWarmed(),
    hourly: dayCurve(),
    canTune: tune.status === "available",
    tuneStatus: tune.status,
    recommended: null, // the first recompute sets it from the engine's facts
  };

  const announce = (msg: string): void => ctx.announce?.(msg);
  /** The working copy as the engine reads a draft: homes only once hand-set. */
  const workingDraft = (): ElevatorSchedule => ({
    ...state.schedule,
    homeFloors: homesDirty ? state.schedule.homeFloors : undefined,
  });
  // Whether the last recompute produced CRITICAL advice, straight from the
  // model (never parsed back out of the rendered copy, which a copy tweak
  // would silently break): the auto-unfold keys on this.
  let adviceCritical = false;
  const recompute = (): void => {
    const isWeekend = state.day === "weekend";
    tune = ctx.autoTune(workingDraft(), isWeekend);
    sctx.hasMeasured = dayWarmed();
    sctx.hourly = dayCurve();
    sctx.canTune = tune.status === "available";
    sctx.tuneStatus = tune.status;
    // The facts read the whole working copy: its homes are the staging the
    // Simulate sentence summarizes.
    const facts = ctx.facts(state.schedule, isWeekend);
    sctx.recommended = facts.recommended;
    const adv = ctx.ux.advice && facts.advice.status === "ready" ? facts.advice : null;
    const advised = adv !== null && (adv.over.length > 0 || adv.short.length > 0);
    adviceCritical = advised;
    if (!adv) state.adviceMsg = "";
    else if (!advised) state.adviceMsg = "Measured demand and your schedule line up.";
    else {
      const parts: string[] = [];
      if (adv.over.length) parts.push(`over-staffed ${fmtHours(adv.over)}`);
      if (adv.short.length) parts.push(`short at ${fmtHours(adv.short)}`);
      state.adviceMsg = `This shaft is ${parts.join(" and ")} on ${state.day}s.`;
    }
    // The Simulate sentence leads with the staging clause, the axis that responds
    // to skill; the on-shift count trails. The base clause names its floor when
    // the base is not the ground lobby (a sky-lobby shaft's "at the lobby" would
    // read as a place it never touches; party ruling, spec §16). A day with no
    // measured ring must not claim a measured peak (#466): its sentence names
    // the assumed 17:00 down-rush instead of "Busiest".
    const sum = facts.staging;
    // The engine's base floor and homes follow every edit, a stop edit included.
    if (sum) state.base = sum.baseLobby;
    if (facts.homeFloors.length === ctx.cars) state.schedule.homeFloors = [...facts.homeFloors];
    if (!sum) {
      state.simMsg = "";
      state.originFloors = [];
      return;
    }
    // floorLabel keeps the pinned B-n basement grammar for below-ground bases.
    const baseClause = sum.baseLobby === 1 ? "at the lobby" : `at Floor ${floorLabel(sum.baseLobby)} (the base)`;
    const peakClause = sum.measured
      ? `Busiest ${state.day} hour ${hh(sum.peakHour)}`
      : `No measured ${state.day} peak yet; at the ${hh(sum.peakHour)} down-rush`;
    // Origin readouts (#465): hotspot markers for the visible day's peak hour,
    // and a trailing boarding clause. Both empty until origins warm.
    // Filter the slot to served floors BEFORE ranking: hotspotFloors takes its
    // share threshold against the slot total, so a skipped floor's stale EMA mass
    // would otherwise push every served floor below threshold and blank the markers.
    const servedNow = new Set(servedFloorsAsc(state.floors));
    const peakSlot = dayOriginsAt(sum.peakHour);
    const servedSlot = peakSlot && new Map([...peakSlot].filter(([f]) => servedNow.has(f)));
    state.originFloors = hotspotFloors(servedSlot || undefined);
    state.simMsg =
      `${peakClause}: ${sum.upTowerCars} staged up-tower, ` +
      `${sum.lobbyCars} ${baseClause}, ${sum.activeAtPeak} of ${ctx.cars} cars on shift.` +
      originClause(state.originFloors);
  };

  function rerender(): void {
    render(elevatorScheduleTemplate(sctx, state, handlers), box);
  }
  /** Advice about strip numbers must not critique a hidden strip: whenever the
   *  sentence turns critical while the Modern fold is shut, open it. */
  const unfoldOnAdvice = (): void => {
    if (!ctx.ux.rawGridDefault && ctx.ux.advice && !state.advancedOpen && adviceCritical) {
      state.advancedOpen = true;
    }
  };
  /** A schedule edit landed: mark dirty, disarm a pending discard, recompute, repaint. */
  const after = (): void => {
    state.dirty = true;
    state.cancelArmed = false;
    recompute();
    unfoldOnAdvice();
    rerender();
  };
  /** A stop edit landed (applied live): refresh rows, recompute (the engine
   *  re-derives the base and snaps the homes onto the new served set), repaint. */
  const afterStops = (): void => {
    state.floors = readFloors();
    state.cancelArmed = false;
    recompute();
    // A stop edit reshapes the shaft context the advice reads, so it can turn
    // the sentence critical too: unfold the Modern strip the same as a schedule
    // edit would (advice must not critique a hidden strip).
    unfoldOnAdvice();
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
  // §8: shift is not a phone key); a third tap resets to the tapped bar. Only a
  // bar the player explicitly tapped anchors a span: the seeded default
  // selection never does, or the FIRST tap would span instead of select. On
  // fine pointers a plain click always re-selects and shift-click extends.
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  let anchored = false;

  const handlers: SchedHandlers = {
    onDay: (day) => {
      state.day = day;
      state.rangeEnd = null;
      anchored = false; // a fresh day view starts unanchored, like open
      state.cancelArmed = false;
      recompute();
      rerender();
    },
    onSelectHour: (h, extend) => {
      const tapExtend = coarse && anchored && state.rangeEnd === null && h !== state.selectedHour;
      if (extend || tapExtend) state.rangeEnd = h;
      else {
        state.selectedHour = h;
        state.rangeEnd = null;
        anchored = true;
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
    // A stop edit settles after the engine answers; a closed dialog skips the repaint.
    onServe: async (floor, serve) => {
      await ctx.stops.setServe(floor, serve);
      if (!box.isConnected) return;
      afterStops();
      // Announce what actually happened: the engine keeps an endpoint a
      // stop, and the re-read rows are the truth.
      const now = state.floors.find((f) => f.floor === floor)?.served;
      const fl = floorLabel(floor); // B-n grammar below ground, matching the grid
      if (now === serve) announce(serve ? `Floor ${fl} served.` : `Floor ${fl} skipped.`);
      else announce(`Floor ${fl} must stay a stop.`);
    },
    onExpressStops: async () => {
      await ctx.stops.expressStops();
      if (!box.isConnected) return;
      announce("Stops set to lobbies only.");
      afterStops();
    },
    onAllStops: async () => {
      await ctx.stops.allStops();
      if (!box.isConnected) return;
      announce("Stopping at every floor.");
      afterStops();
    },
    onHomeSet: (car, floor) => {
      // Re-pressing a car's own home chip changes nothing: do not mark the
      // working copy dirty (which would arm the discard guard) for a no-op.
      if (state.schedule.homeFloors[car] === floor) return;
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
      const play = ctx.preset("stage-up-tower");
      if (play.status !== "available") return;
      state.schedule.homeFloors = [...play.homeFloors];
      homesDirty = true;
      after();
    },
    onAllCars: () => { state.schedule.activeCars = { weekday: fullRow(), weekend: fullRow() }; announce(`All ${ctx.cars} cars now run every hour, both day types.`); after(); },
    onPreset: (p: AssistedPreset) => {
      const preset = ctx.preset(p);
      if (preset.status !== "available") return; // the mode offers no presets; the buttons are not shown
      state.schedule.activeCars = {
        weekday: preset.weekday ? [...preset.weekday] : fullRow(),
        weekend: preset.weekend ? [...preset.weekend] : fullRow(),
      };
      // A preset re-stages only staging the player has not hand-set (spec §14.3):
      // counts are its business, a hand-placed fleet is not.
      if (!homesDirty) state.schedule.homeFloors = [...preset.homeFloors];
      announce(`Applied the ${PRESET_LABEL[p] ?? "Feeder"} schedule.`);
      after();
    },
    onAutoTune: () => {
      // Ask the engine against the working copy, handing over homes only once
      // the player has staged by hand so an untouched shaft gets the seed.
      const res = ctx.autoTune(workingDraft(), state.day === "weekend");
      const p = res.proposal;
      if (res.status !== "available" || !p) {
        // Only a cold shaft is fixed by waiting; any other refusal (the shaft
        // is gone, the mode offers none) stays quiet rather than mislead.
        if (res.status === "insufficient-data") announce("Auto-tune needs a day or two of measured traffic first.");
        return;
      }
      // A day the engine left untuned (its ring unmeasured, #466) keeps ITS OWN
      // working row; falling back to curRow() would copy the visible day across.
      state.schedule.activeCars = {
        weekday: p.weekday ? [...p.weekday] : [...(state.schedule.activeCars?.weekday ?? fullRow())],
        weekend: p.weekend ? [...p.weekend] : [...(state.schedule.activeCars?.weekend ?? fullRow())],
      };
      state.schedule.homeFloors = [...p.homeFloors];
      // Name the days that were actually tuned: on a cold Weekend tab a blanket
      // "auto-tuned" would claim a change the visible row never shows (#466).
      const tunedDays = [res.weekday.warm ? "weekday" : null, res.weekend.warm ? "weekend" : null].filter(Boolean);
      announce(
        `Auto-tuned the ${tunedDays.join(" and ")} ${tunedDays.length > 1 ? "schedules" : "schedule"} and staging to measured demand.`,
      );
      after();
    },
    onToggleAdvanced: () => {
      state.advancedOpen = !state.advancedOpen;
      rerender();
    },
    onOk: () => {
      if (applying) return;
      applying = true;
      void cb.apply({
        activeCars: {
          weekday: [...state.schedule.activeCars.weekday!],
          weekend: [...state.schedule.activeCars.weekend!],
        },
        waitingCarResponse: state.schedule.waitingCarResponse,
        standardFloorDeparture: state.schedule.standardFloorDeparture,
        homeFloors: [...state.schedule.homeFloors],
      }).finally(() => box.isConnected && ui.closeModal());
    },
    onCancel: () => {
      // A dirty working copy takes two presses: the first arms "Discard changes?",
      // any edit disarms (spec §8). Every dismissal path funnels here (see below).
      if (state.dirty && !state.cancelArmed) {
        state.cancelArmed = true;
        rerender();
        return;
      }
      ui.closeModal();
    },
  };

  recompute();
  unfoldOnAdvice(); // an already-critical shaft opens with the fold unfolded
  const box = ui.openModalTemplate(elevatorScheduleTemplate(sctx, state, handlers));
  // The dirty guard must cover EVERY dismissal, not just the Cancel button: Esc and
  // the title-bar ✕ arrive as the dialog's cancelable "cancel" event, a backdrop
  // click as a click on the dialog element itself. finishModal re-sets both
  // handlers fresh on every open, so overriding them here cannot leak into other
  // dialogs; preventDefault holds the native Esc close while the confirm arms.
  const dlg = box.closest("dialog");
  if (dlg instanceof HTMLDialogElement) {
    dlg.oncancel = (e) => {
      if (state.dirty && !state.cancelArmed) e.preventDefault();
      handlers.onCancel();
    };
    dlg.onclick = (e) => {
      if (e.target === dlg) handlers.onCancel();
    };
  }
}
