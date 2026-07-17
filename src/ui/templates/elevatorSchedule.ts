import { html, nothing, type TemplateResult } from "lit-html";
import type { ElevatorSchedule } from "../../engine/elevatorSchedule";
import type { ElevatorScheduleUX } from "../../engine/elevatorSchedule";
import type { SchedulePreset } from "../../engine/scheduleAuthoring";

/**
 * The per-shaft elevator Schedule dialog (elevator-scheduling #305 Phase 3), a pure
 * function of local dialog `state` re-rendered by the controller on every input, in
 * the `batchPricing` mold. Renders Classic vs Modern off the `elevatorScheduleUX`
 * flags (never the mode string): Classic shows the raw manual grid with no presets or
 * advice; Modern leads with presets, Auto-tune, the staging list, and advice, with the
 * count grid behind an Advanced disclosure. Positioning-first (spec §14): the home-floor
 * staging list is the primary surface, the count strip is secondary, and Simulate scores
 * staging. All copy is pinned to `ux-elevator-schedule-dialog-2026-07-17.md` §11.
 */

export interface SchedCtx {
  title: string;
  ux: ElevatorScheduleUX;
  isExpress: boolean;
  cars: number;
  /** Served floors that carry a (sky) lobby, ascending: the preset staging targets. */
  servedLobbies: number[];
  /** All served floors, ascending: the per-car home-floor choices (a car may home at
   *  any floor its shaft stops at, not only a lobby). */
  servedFloors: number[];
  /** Whether the shaft has warmed up a measured curve (enables Auto-tune / advice). */
  hasMeasured: boolean;
  recommended: SchedulePreset;
}

export interface SchedState {
  day: "weekday" | "weekend";
  /** The hour the strip stepper is editing (0..23). */
  selectedHour: number;
  /** Modern only: the raw count grid is folded behind Advanced until opened. */
  advancedOpen: boolean;
  /** The live working copy (fully populated: both day rows length 24, homeFloors
   *  length cars, both tunables set). */
  schedule: Required<Pick<ElevatorSchedule, "activeCars" | "homeFloors" | "waitingCarResponse" | "standardFloorDeparture">>;
  /** Derived, computed by the controller: the advice sentence ("" when none) and the
   *  Simulate staging readout. */
  adviceMsg: string;
  simMsg: string;
}

export interface SchedHandlers {
  onDay: (day: "weekday" | "weekend") => void;
  onSelectHour: (h: number) => void;
  onHourStep: (dir: 1 | -1) => void;
  onWcrStep: (dir: 1 | -1) => void;
  onSfdStep: (dir: 1 | -1) => void;
  onHomeSet: (car: number, floor: number) => void;
  onHomeAllBase: () => void;
  onStageUpTower: () => void;
  onPreset: (preset: SchedulePreset) => void;
  onAutoTune: () => void;
  onToggleAdvanced: () => void;
  onOk: () => void;
  onCancel: () => void;
}

const PRESET_LABEL: Record<SchedulePreset, string> = { rush: "Rush", balanced: "Balanced", feeder: "Feeder" };

/** The live count row for the selected day. */
function row(state: SchedState): number[] {
  return (state.day === "weekend" ? state.schedule.activeCars.weekend : state.schedule.activeCars.weekday) ?? [];
}

/** The 24-hour count strip: each hour a bar whose fill height is its active count,
 *  the selected hour outlined, the count printed on the bar (no hover needed). Click
 *  selects; the docked stepper below sets the selected hour. */
function stripTemplate(ctx: SchedCtx, state: SchedState, h: SchedHandlers): TemplateResult {
  const r = row(state);
  const sel = state.selectedHour;
  const n = r[sel] ?? ctx.cars;
  return html`
    <div class="es-strip-wrap">
      <div class="es-strip-head"><span class="es-heading">Cars on shift by hour</span>
        <span class="es-fleet">Fleet: ${ctx.cars} cars</span></div>
      <div class="es-strip" role="group" aria-label="Cars on shift by hour, ${state.day}">
        ${r.map((v, hr) => html`
          <button type="button" class="es-bar${hr === sel ? " sel" : ""}" role="slider"
            aria-label="${state.day} ${String(hr).padStart(2, "0")}:00, ${v} of ${ctx.cars} cars"
            aria-valuemin="0" aria-valuemax=${ctx.cars} aria-valuenow=${v}
            @click=${() => h.onSelectHour(hr)}>
            <span class="es-bar-fill" style="height:${ctx.cars > 0 ? (v / ctx.cars) * 100 : 0}%"></span>
            <span class="es-bar-n">${v}</span>
          </button>`)}
      </div>
      <div class="es-strip-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
      <div class="es-row es-strip-step">
        <span>Hour ${String(sel).padStart(2, "0")}:00</span>
        <span class="es-stepper">
          <button type="button" class="btn es-sq" aria-label="fewer cars" ?disabled=${n <= 0} @click=${() => h.onHourStep(-1)}>–</button>
          <span class="es-val">${n} car${n === 1 ? "" : "s"}</span>
          <button type="button" class="btn es-sq" aria-label="more cars" ?disabled=${n >= ctx.cars} @click=${() => h.onHourStep(1)}>+</button>
        </span>
      </div>
    </div>`;
}

/** The two response steppers with their live legibility sentences (spec §3, §14.3). */
function steppersTemplate(state: SchedState, h: SchedHandlers): TemplateResult {
  const wcr = state.schedule.waitingCarResponse;
  const sfd = state.schedule.standardFloorDeparture;
  return html`
    <div class="es-row es-spread">
      <span>Waiting Car Response</span>
      <span class="es-stepper">
        <button type="button" class="btn es-sq" aria-label="lower" ?disabled=${wcr <= 0} @click=${() => h.onWcrStep(-1)}>–</button>
        <span class="es-val">${wcr}</span>
        <button type="button" class="btn es-sq" aria-label="raise" ?disabled=${wcr >= 30} @click=${() => h.onWcrStep(1)}>+</button>
      </span>
    </div>
    <p class="es-hint">${wcr === 0 ? "Idle cars answer the nearest call." : "Higher holds idle cars in place longer."}</p>
    <div class="es-row es-spread">
      <span>Standard Floor Departure</span>
      <span class="es-stepper">
        <button type="button" class="btn es-sq" aria-label="lower" ?disabled=${sfd <= 0} @click=${() => h.onSfdStep(-1)}>–</button>
        <span class="es-val">${sfd} sec</span>
        <button type="button" class="btn es-sq" aria-label="raise" ?disabled=${sfd >= 60} @click=${() => h.onSfdStep(1)}>+</button>
      </span>
    </div>
    <p class="es-hint">Longer holds a car at each stop; fewer trips, steadier loading.</p>`;
}

/** The home-floor staging list: the primary skill surface (spec §14.2). Per-car home
 *  floor picked from the served lobbies, plus the two one-press staging quick-actions. */
function stagingTemplate(ctx: SchedCtx, state: SchedState, h: SchedHandlers): TemplateResult {
  const homes = state.schedule.homeFloors;
  const floors = ctx.servedFloors.length > 0 ? ctx.servedFloors : ctx.servedLobbies;
  return html`
    <div class="es-stage">
      <div class="es-row es-heading-row"><span class="es-heading">Home floors (staging)</span></div>
      <div class="es-row es-quick">
        <button type="button" class="btn" @click=${h.onHomeAllBase}>Home all cars here</button>
        <button type="button" class="btn" @click=${h.onStageUpTower}>Stage upper half up-tower</button>
      </div>
      <div class="es-homes" role="group" aria-label="Per-car home floors">
        ${homes.map((f, car) => html`
          <label class="es-home-row">
            <span>Car ${car + 1}</span>
            <!-- Selection rides data-current + a post-render syncRungSelects pass
                 (see rungPicker.ts): option bindings commit before attach, where
                 selection writes are unreliable. -->
            <select class="field es-home-sel" aria-label="Car ${car + 1} home floor" data-current=${String(f)}
              @change=${(e: Event) => h.onHomeSet(car, Number((e.target as HTMLSelectElement).value))}>
              ${floors.map((fl) => html`<option value=${fl}>Floor ${fl}</option>`)}
            </select>
          </label>`)}
      </div>
    </div>`;
}

function presetsTemplate(ctx: SchedCtx, h: SchedHandlers): TemplateResult {
  return html`
    <div class="es-row es-presets">
      ${(["rush", "balanced", "feeder"] as SchedulePreset[]).map((p) => html`
        <button type="button" class="btn${p === ctx.recommended ? " es-rec" : ""}" @click=${() => h.onPreset(p)}
          title=${p === ctx.recommended ? "Recommended for this shaft" : ""}>${PRESET_LABEL[p]}</button>`)}
      <button type="button" class="btn es-autotune" ?disabled=${!ctx.hasMeasured} @click=${h.onAutoTune}>Auto-tune</button>
    </div>
    ${ctx.hasMeasured ? nothing : html`<p class="es-hint">Auto-tune needs a day or two of measured traffic first.</p>`}`;
}

export function elevatorScheduleTemplate(ctx: SchedCtx, state: SchedState, h: SchedHandlers): TemplateResult {
  const modern = ctx.ux.presets; // Modern shows presets/auto-tune/advice
  const strip = stripTemplate(ctx, state, h);
  // No .modal-box wrapper here: openModalTemplate supplies it, and finishModal
  // skins only a DIRECT-child h2 as the title bar (same grammar as batchPricing).
  return html`
      <h2>${ctx.title}</h2>
      <div class="es-body">
        <div class="es-row es-day" role="group" aria-label="Day type">
          <button type="button" class="btn${state.day === "weekday" ? " es-on" : ""}" aria-pressed=${state.day === "weekday"} @click=${() => h.onDay("weekday")}>Weekday</button>
          <button type="button" class="btn${state.day === "weekend" ? " es-on" : ""}" aria-pressed=${state.day === "weekend"} @click=${() => h.onDay("weekend")}>Weekend</button>
        </div>

        ${modern ? presetsTemplate(ctx, h) : nothing}

        <!-- Positioning-first: staging leads. -->
        ${stagingTemplate(ctx, state, h)}

        ${steppersTemplate(state, h)}

        <!-- The count grid: primary in Classic (rawGridDefault), behind Advanced in Modern. -->
        ${ctx.ux.rawGridDefault
          ? strip
          : html`<details class="es-adv" ?open=${state.advancedOpen}>
              <summary @click=${(e: Event) => { e.preventDefault(); h.onToggleAdvanced(); }}>Cars on shift by hour (Advanced)</summary>
              ${state.advancedOpen ? strip : nothing}
            </details>`}

        ${modern && state.adviceMsg ? html`<p class="es-advice" aria-live="polite">${state.adviceMsg}</p>` : nothing}
        <div class="es-sim" aria-live="polite">${state.simMsg}</div>
      </div>
      <div class="modal-actions">
        <button class="btn primary" data-act="apply" @click=${h.onOk}>OK</button>
        <button class="btn" data-act="close" @click=${h.onCancel}>Cancel</button>
      </div>`;
}
