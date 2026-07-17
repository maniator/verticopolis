import { html, nothing, type TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { ElevatorSchedule, ElevatorScheduleUX } from "../../engine/elevatorSchedule";
import type { SchedulePreset } from "../../engine/scheduleAuthoring";

/**
 * The per-shaft elevator Schedule dialog (elevator-scheduling #305 Phase 3, floors
 * fold-in #464), a pure function of local dialog `state` re-rendered by the
 * controller on every input, in the `batchPricing` mold. Renders Classic vs Modern
 * off the `elevatorScheduleUX` flags (never the mode string): Classic shows the raw
 * manual grid with no presets or advice; Modern leads with presets, Auto-tune, and
 * advice, with the count grid behind an Advanced disclosure.
 *
 * The primary surface is the FLOORS GRID (spec §4 as amended §16): one row per span
 * floor, descending, carrying the Serve stop toggle (the old `Configure stops…`
 * dialog, folded in and retired), the derived base marker, and one numbered chip per
 * car marking its home floor, the 1994 Elevator window's floors-by-cars shape. The
 * count strip is secondary and carries the measured-demand ghost when the shaft has
 * warmed up (both modes: information, never advice). Copy is pinned to
 * `ux-elevator-schedule-dialog-2026-07-17.md` §11/§16.
 */

/** One span floor's live row: serve state and whether a (sky) lobby sits there. */
export interface FloorRow {
  floor: number;
  served: boolean;
  lobby: boolean;
  /** A span endpoint: always a stop (the shaft cannot disconnect from itself),
   *  so the grid renders a fixed mark there, never a toggle. */
  endpoint?: boolean;
}

export interface SchedCtx {
  title: string;
  ux: ElevatorScheduleUX;
  isExpress: boolean;
  cars: number;
  /** Whether the shaft has warmed up a measured curve (enables Auto-tune / advice,
   *  and the ghost series in both modes). */
  hasMeasured: boolean;
  /** The warmed measured curve for DISPLAY (the ghost series), or undefined. */
  hourly?: readonly number[];
  recommended: SchedulePreset;
}

export interface SchedState {
  day: "weekday" | "weekend";
  /** The hour the strip stepper is editing (0..23), the anchor of any span. */
  selectedHour: number;
  /** Span end (inclusive; shift-click, or second tap on touch), or null. */
  rangeEnd: number | null;
  /** Modern only: the raw count grid is folded behind Advanced until opened. */
  advancedOpen: boolean;
  /** Dirty-cancel arm: the Cancel button reads "Discard changes?" until re-pressed. */
  cancelArmed: boolean;
  /** Live span floors, DESCENDING (top first, like the tower), refreshed from the
   *  engine after every Serve toggle. */
  floors: FloorRow[];
  /** The derived base floor (lowest served lobby, else the shaft bottom): the
   *  unhomed-car fallback, marked in the grid. */
  base: number;
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
  onSelectHour: (h: number, extend: boolean) => void;
  onBarKey: (h: number, key: string) => void;
  onHourStep: (dir: 1 | -1) => void;
  onWcrStep: (dir: 1 | -1) => void;
  onSfdStep: (dir: 1 | -1) => void;
  /** Serve toggle for one floor (the folded-in stops model; applies live). */
  onServe: (floor: number, serve: boolean) => void;
  /** The folded-in bulk stop actions (standard/service only). */
  onExpressStops: () => void;
  onAllStops: () => void;
  /** Home car `car` at `floor` (a chip press in the grid). */
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

/** The ascending inclusive [start, end] hour span of the selection. */
function span(state: SchedState): [number, number] {
  const a = state.selectedHour;
  const b = state.rangeEnd ?? a;
  return a <= b ? [a, b] : [b, a];
}

const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/** Floor label with the basement grammar the retired stops dialog pinned: B1,
 *  B2... below ground, plain numbers above. */
export function floorLabel(floor: number): string {
  return floor < 1 ? `B${1 - floor}` : String(floor);
}

/** Press-and-hold auto-repeat for a stepper button: fires the handler once per
 *  ~150ms after a 400ms hold, so 8 presses of − collapse into one hold. Attached
 *  via @pointerdown; the plain @click still fires the single step on release of a
 *  short press, so the two never double-fire (the repeat only starts after the
 *  hold delay, and a repeat run suppresses the trailing click). */
function holdRepeat(fire: () => void): (e: PointerEvent) => void {
  return (e: PointerEvent) => {
    if (e.button !== 0) return; // primary button/touch only: no right-hold repeats
    const btn = e.currentTarget as HTMLButtonElement;
    let repeated = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        // A dismissed dialog detaches the button with no pointerup to stop us:
        // the connectivity check is the teardown of last resort.
        if (btn.disabled || !btn.isConnected) return stop();
        repeated = true;
        fire();
      }, 150);
    }, 400);
    const swallowClick = (ce: Event): void => {
      if (repeated) {
        ce.stopPropagation();
        ce.preventDefault();
      }
    };
    const stop = (): void => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
      btn.removeEventListener("pointerup", stop);
      btn.removeEventListener("pointercancel", stop);
      btn.removeEventListener("pointerleave", stop);
      // Capture-phase so the swallow beats the inline @click when a repeat ran.
      setTimeout(() => btn.removeEventListener("click", swallowClick, true), 0);
    };
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("pointerleave", stop);
    btn.addEventListener("click", swallowClick, true);
  };
}

/** A − / + stepper pair around a value readout, with press-and-hold repeat. */
function stepper(
  value: TemplateResult | string,
  canDown: boolean,
  canUp: boolean,
  onStep: (dir: 1 | -1) => void,
  labels: [string, string],
): TemplateResult {
  return html`<span class="es-stepper">
    <button type="button" class="btn es-sq" aria-label=${labels[0]} ?disabled=${!canDown}
      @pointerdown=${holdRepeat(() => onStep(-1))} @click=${() => onStep(-1)}>–</button>
    <span class="es-val">${value}</span>
    <button type="button" class="btn es-sq" aria-label=${labels[1]} ?disabled=${!canUp}
      @pointerdown=${holdRepeat(() => onStep(1))} @click=${() => onStep(1)}>+</button>
  </span>`;
}

/** The 24-hour count strip: each hour a bar whose fill height is its active count,
 *  the selected span outlined, the count printed on the bar, count gridlines behind,
 *  and the measured-demand ghost (a tick per hour, with the authored fill above the
 *  measured line grayed as visible over-supply) when the shaft has warmed up. Click
 *  selects, shift-click (or a second tap on touch, handled by the controller)
 *  extends the span, arrows adjust (up/down) and move (left/right); the docked
 *  stepper edits the whole span. The bars, gridlines, and hour axis share one inner
 *  scroller so the axis labels stay under the bars they describe when the strip
 *  scrolls on touch. */
function stripTemplate(ctx: SchedCtx, state: SchedState, h: SchedHandlers): TemplateResult {
  const r = row(state);
  const [a, b] = span(state);
  const n = r[state.selectedHour] ?? ctx.cars;
  const spanLabel = a === b ? `Hour ${hh(a)}` : `Hours ${hh(a)}–${hh(b)}`;
  const demandAt = (hr: number): number | undefined =>
    ctx.hourly ? Math.max(0, Math.min(1, ctx.hourly[hr] ?? 0)) : undefined;
  return html`
    <div class="es-strip-wrap">
      <div class="es-strip-head"><span class="es-heading">Cars on shift by hour</span>
        <span class="es-fleet">${n} of ${ctx.cars}</span></div>
      <div class="es-strip">
        <div class="es-strip-inner">
          <div class="es-strip-bars" role="group" aria-label="Cars on shift by hour, ${state.day}">
            ${Array.from({ length: Math.max(0, ctx.cars - 1) }, (_, i) => html`<span
              class="es-gridline" style="bottom:${((i + 1) / ctx.cars) * 100}%"></span>`)}
            ${r.map((v, hr) => {
              const d = demandAt(hr);
              const fillPct = ctx.cars > 0 ? (v / ctx.cars) * 100 : 0;
              const demandPct = d !== undefined ? d * 100 : undefined;
              return html`
              <button type="button" class="es-bar${hr >= a && hr <= b ? " sel" : ""}" role="slider"
                aria-label="${state.day} ${hh(hr)}, ${v} of ${ctx.cars} cars"
                aria-valuemin="0" aria-valuemax=${ctx.cars} aria-valuenow=${v}
                @click=${(e: MouseEvent) => h.onSelectHour(hr, !!e.shiftKey)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    h.onBarKey(hr, e.key);
                  }
                }}>
                <span class="es-bar-fill" style="height:${fillPct}%"></span>
                ${demandPct !== undefined && fillPct > demandPct
                  ? html`<span class="es-bar-over" style="bottom:${demandPct}%;height:${fillPct - demandPct}%"></span>`
                  : nothing}
                ${demandPct !== undefined
                  ? html`<span class="es-bar-demand" style="bottom:${demandPct}%"></span>`
                  : nothing}
                <span class="es-bar-n">${v}</span>
              </button>`;
            })}
          </div>
          <div class="es-strip-axis" aria-hidden="true">
            ${[0, 6, 12, 18].map((hr) => html`<span class="es-axis-tick" style="left:${(hr / 24) * 100}%">${hr}</span>`)}
          </div>
        </div>
      </div>
      ${ctx.hourly
        ? html`<p class="es-hint es-legend">Dashes mark measured demand; the pale bar top is spare capacity.</p>`
        : nothing}
      <p class="es-hint es-touch-hint">Tap an hour, then set its cars with − and +. A second tap spans hours.</p>
      <div class="es-row es-strip-step">
        <span>${spanLabel}</span>
        ${stepper(html`${n} car${n === 1 ? "" : "s"}`, n > 0, n < ctx.cars, h.onHourStep, ["fewer cars", "more cars"])}
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
      ${stepper(html`${wcr}`, wcr > 0, wcr < 30, h.onWcrStep, ["lower", "raise"])}
    </div>
    <p class="es-hint">${wcr === 0 ? "Idle cars answer the nearest call." : "Higher holds idle cars in place longer."}</p>
    <div class="es-row es-spread">
      <span>Standard Floor Departure</span>
      ${stepper(html`${sfd} sec`, sfd > 0, sfd < 60, h.onSfdStep, ["lower", "raise"])}
    </div>
    <p class="es-hint">Longer holds a car at each stop; fewer trips, steadier loading.</p>`;
}

/** The floors grid: the dialog's primary surface (spec §4 as amended §16), one row
 *  per span floor descending, with the folded-in Serve stop toggle, the derived base
 *  marker, and one numbered chip per car (pressed on its home row; pressing a hollow
 *  chip moves that car here). Express renders a caption instead of Serve toggles
 *  (its stops are lobbies by construction: a caption reads as a fact, a grayed
 *  control reads as a bug). */
function floorsTemplate(ctx: SchedCtx, state: SchedState, h: SchedHandlers): TemplateResult {
  const homes = state.schedule.homeFloors;
  const baseLabel = state.base === 1 ? "Home all cars at the lobby" : `Home all cars at Floor ${floorLabel(state.base)}`;
  return html`
    <div class="es-floors">
      <div class="es-row es-heading-row"><span class="es-heading">Serviced floors and home cars</span></div>
      ${ctx.isExpress ? html`<p class="es-hint">Serves all lobbies and sky lobbies</p>` : nothing}
      <div class="es-row es-quick">
        ${ctx.isExpress
          ? nothing
          : html`<button type="button" class="btn" @click=${h.onExpressStops}>Express (lobbies)</button>
              <button type="button" class="btn" @click=${h.onAllStops}>All stops</button>`}
        <button type="button" class="btn" @click=${h.onHomeAllBase}>${baseLabel}</button>
        <button type="button" class="btn" @click=${h.onStageUpTower}>Stage upper half up-tower</button>
      </div>
      <div class="es-grid" role="group" aria-label="Serviced floors and per-car home floors">
        <div class="es-grid-head es-grid-row" aria-hidden="true">
          <span class="es-cell-floor">Floor</span>
          ${ctx.isExpress ? nothing : html`<span class="es-cell-serve">Serve</span>`}
          <span class="es-cell-cars">Home car(s)</span>
        </div>
        ${state.floors.map((f) => {
          const isBase = f.floor === state.base;
          return html`
          <div class="es-grid-row${f.served ? "" : " es-skipped"}">
            <span class="es-cell-floor">${isBase ? html`<span class="es-base" title="Base floor: unhomed cars wait here">◎</span>` : nothing}${floorLabel(f.floor)}${f.lobby ? html`<span class="es-lobby-mark" title="Lobby floor">L</span>` : nothing}</span>
            ${ctx.isExpress
              ? nothing
              : f.endpoint
                ? html`<span class="es-cell-serve es-always" title="The top and bottom stay connected: endpoints always stop">✓</span>`
                : html`<span class="es-cell-serve"><input type="checkbox" aria-label="Serve floor ${floorLabel(f.floor)}"
                    .checked=${live(f.served)} @change=${(e: Event) => h.onServe(f.floor, (e.target as HTMLInputElement).checked)} /></span>`}
            <span class="es-cell-cars">
              ${f.served
                ? Array.from({ length: ctx.cars }, (_, car) => {
                    const here = homes[car] === f.floor;
                    return html`<button type="button" class="es-chip${here ? " on" : ""}"
                      aria-label="Home car ${car + 1} at floor ${floorLabel(f.floor)}" aria-pressed=${here}
                      @click=${() => h.onHomeSet(car, f.floor)}>${car + 1}</button>`;
                  })
                : nothing}
            </span>
          </div>`;
        })}
      </div>
    </div>`;
}

function presetsTemplate(ctx: SchedCtx, h: SchedHandlers): TemplateResult {
  return html`
    <div class="es-row es-presets">
      ${(["rush", "balanced", "feeder"] as SchedulePreset[]).map((p) => html`
        <button type="button" class="btn${p === ctx.recommended ? " es-rec" : ""}" @click=${() => h.onPreset(p)}
          title=${p === ctx.recommended ? "Recommended for this shaft" : ""}>${PRESET_LABEL[p]}</button>`)}
      ${ctx.ux.autoTune
        ? html`<button type="button" class="btn es-autotune" ?disabled=${!ctx.hasMeasured} @click=${h.onAutoTune}>Auto-tune</button>`
        : nothing}
    </div>
    ${ctx.ux.autoTune && !ctx.hasMeasured ? html`<p class="es-hint">Auto-tune needs a day or two of measured traffic first.</p>` : nothing}`;
}

export function elevatorScheduleTemplate(ctx: SchedCtx, state: SchedState, h: SchedHandlers): TemplateResult {
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

        ${ctx.ux.presets ? presetsTemplate(ctx, h) : nothing}

        <!-- Positioning-first: the floors grid (staging + the folded-in stops) leads. -->
        ${floorsTemplate(ctx, state, h)}

        ${steppersTemplate(state, h)}

        <!-- The count grid: primary in Classic (rawGridDefault), behind Advanced in Modern. -->
        ${ctx.ux.rawGridDefault
          ? strip
          : html`<details class="es-adv" ?open=${state.advancedOpen}>
              <summary @click=${(e: Event) => { e.preventDefault(); h.onToggleAdvanced(); }}>Cars on shift by hour (Advanced)</summary>
              ${state.advancedOpen ? strip : nothing}
            </details>`}

        ${ctx.ux.advice && state.adviceMsg ? html`<p class="es-advice" aria-live="polite">${state.adviceMsg}</p>` : nothing}
        <div class="es-sim" aria-live="polite">${state.simMsg}</div>
      </div>
      <div class="modal-actions">
        <button class="btn primary" data-act="apply" @click=${h.onOk}>OK</button>
        <button class="btn" data-act="close" @click=${h.onCancel}>${state.cancelArmed ? "Discard changes?" : "Cancel"}</button>
      </div>`;
}
