import { describe, it, expect, vi } from "vitest";
import {
  elevatorScheduleTemplate,
  type SchedCtx,
  type SchedState,
  type SchedHandlers,
} from "./elevatorSchedule";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import { renderToFragment, click, change } from "../testing/litTestUtils";

/**
 * The per-shaft elevator Schedule dialog template (elevator-scheduling #305
 * Phase 3). The template is a pure function of `state`; the controller
 * re-renders it on each event. Package: the Classic vs Modern shape (raw grid
 * primary vs presets + Advanced fold), the staging list, the steppers'
 * clamping affordances, and the inline handler wiring. The reactive flow
 * (recompute, apply-through-setSchedule) is pinned by the controller and
 * gameControllers integration tests.
 */

const noop: SchedHandlers = {
  onDay: () => {},
  onSelectHour: () => {},
  onBarKey: () => {},
  onHourStep: () => {},
  onWcrStep: () => {},
  onSfdStep: () => {},
  onHomeSet: () => {},
  onHomeAllBase: () => {},
  onStageUpTower: () => {},
  onPreset: () => {},
  onAutoTune: () => {},
  onToggleAdvanced: () => {},
  onOk: () => {},
  onCancel: () => {},
};

const ctx = (over: Partial<SchedCtx> = {}): SchedCtx => ({
  title: "Schedule: Standard elevator (floors 1-10)",
  ux: MODERN_RULES.elevatorScheduleUX(),
  isExpress: false,
  cars: 4,
  servedLobbies: [1],
  servedFloors: [1, 2, 3, 4],
  hasMeasured: true,
  recommended: "rush",
  baseLobby: 1,
  ...over,
});

const state = (over: Partial<SchedState> = {}): SchedState => ({
  day: "weekday",
  selectedHour: 17,
  rangeEnd: null,
  advancedOpen: false,
  cancelArmed: false,
  schedule: {
    activeCars: { weekday: Array(24).fill(4), weekend: Array(24).fill(4) },
    homeFloors: [1, 1, 1, 1],
    waitingCarResponse: 0,
    standardFloorDeparture: 48,
  },
  adviceMsg: "",
  simMsg: "Busiest weekday hour 17:00: 4 of 4 cars, 0 staged up-tower, 4 at the lobby.",
  ...over,
});

describe("elevatorScheduleTemplate: Classic vs Modern shape", () => {
  it("Classic shows the raw count strip with no presets, Advanced fold, or advice", () => {
    const frag = renderToFragment(
      elevatorScheduleTemplate(ctx({ ux: CLASSIC_RULES.elevatorScheduleUX() }), state({ adviceMsg: "ignored" }), noop),
    );
    expect(frag.querySelector(".es-strip")).not.toBeNull();
    expect(frag.querySelector(".es-adv")).toBeNull();
    expect(frag.querySelector(".es-presets")).toBeNull();
    expect(frag.querySelector(".es-advice")).toBeNull();
  });

  it("Modern leads with presets and folds the strip behind Advanced (closed by default)", () => {
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state(), noop));
    expect(frag.querySelector(".es-presets")).not.toBeNull();
    expect(frag.querySelector(".es-adv")).not.toBeNull();
    expect(frag.querySelector(".es-strip")).toBeNull(); // rendered only once opened
  });

  it("Modern renders the strip once Advanced is open, and shows the advice line", () => {
    const frag = renderToFragment(
      elevatorScheduleTemplate(ctx(), state({ advancedOpen: true, adviceMsg: "This shaft is short at 08:00 on weekdays." }), noop),
    );
    expect(frag.querySelector(".es-strip")).not.toBeNull();
    expect(frag.querySelectorAll(".es-bar")).toHaveLength(24);
    expect(frag.querySelector(".es-advice")!.textContent).toContain("short at 08:00");
  });

  it("marks the recommended preset and disables Auto-tune before the shaft warms up", () => {
    const frag = renderToFragment(elevatorScheduleTemplate(ctx({ hasMeasured: false, recommended: "feeder" }), state(), noop));
    const rec = frag.querySelector(".es-presets .es-rec")!;
    expect(rec.textContent).toBe("Feeder");
    expect(frag.querySelector<HTMLButtonElement>(".es-autotune")!.disabled).toBe(true);
    expect(frag.textContent).toContain("Auto-tune needs a day or two of measured traffic first.");
  });
});

describe("elevatorScheduleTemplate: staging list", () => {
  it("renders one home-floor row per car, selection riding data-current", () => {
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state({ schedule: { ...state().schedule, homeFloors: [1, 2, 3, 4] } }), noop));
    const sels = frag.querySelectorAll<HTMLSelectElement>(".es-home-sel");
    expect(sels).toHaveLength(4);
    expect(Array.from(sels).map((s) => s.dataset.current)).toEqual(["1", "2", "3", "4"]);
    expect(sels[0].querySelectorAll("option")).toHaveLength(4); // one per served floor
    expect(frag.textContent).toContain("Car 1");
    expect(frag.textContent).toContain("Car 4");
  });

  it("wires the quick staging actions and the per-car change", () => {
    const onHomeAllBase = vi.fn();
    const onStageUpTower = vi.fn();
    const onHomeSet = vi.fn();
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state(), { ...noop, onHomeAllBase, onStageUpTower, onHomeSet }));
    const quick = frag.querySelectorAll(".es-quick .btn");
    click(quick[0]);
    click(quick[1]);
    expect(onHomeAllBase).toHaveBeenCalledOnce();
    expect(onStageUpTower).toHaveBeenCalledOnce();
    const sel = frag.querySelectorAll<HTMLSelectElement>(".es-home-sel")[2];
    sel.value = "3";
    change(sel);
    expect(onHomeSet).toHaveBeenCalledWith(2, 3);
  });
});

describe("elevatorScheduleTemplate: steppers and strip", () => {
  it("disables the − at the floor and the + at the ceiling of each tunable", () => {
    const s = state();
    s.schedule.waitingCarResponse = 0;
    s.schedule.standardFloorDeparture = 60;
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), s, noop));
    const steppers = frag.querySelectorAll(".es-spread .es-stepper");
    const wcr = steppers[0].querySelectorAll<HTMLButtonElement>("button");
    expect(wcr[0].disabled).toBe(true); // WCR at 0: can't lower
    expect(wcr[1].disabled).toBe(false);
    const sfd = steppers[1].querySelectorAll<HTMLButtonElement>("button");
    expect(sfd[0].disabled).toBe(false);
    expect(sfd[1].disabled).toBe(true); // SFD at 60: can't raise
  });

  it("keeps each tunable's plain-language hint in sync with its value", () => {
    const idle = renderToFragment(elevatorScheduleTemplate(ctx(), state(), noop));
    expect(idle.textContent).toContain("Idle cars answer the nearest call.");
    const s = state();
    s.schedule.waitingCarResponse = 8;
    const held = renderToFragment(elevatorScheduleTemplate(ctx(), s, noop));
    expect(held.textContent).toContain("Higher holds idle cars in place longer.");
  });

  it("the strip outlines the selected hour, prints counts on the bars, and clicks select", () => {
    const onSelectHour = vi.fn();
    const s = state({ advancedOpen: true });
    s.schedule.activeCars.weekday![9] = 2;
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), s, { ...noop, onSelectHour }));
    const bars = frag.querySelectorAll(".es-bar");
    expect(bars[17].classList.contains("sel")).toBe(true);
    expect(bars[9].getAttribute("aria-valuenow")).toBe("2");
    expect(bars[9].textContent).toContain("2");
    click(bars[9]);
    expect(onSelectHour).toHaveBeenCalledWith(9, false);
  });

  it("routes arrow keys through onBarKey and shift-click extends the span", () => {
    const onBarKey = vi.fn();
    const onSelectHour = vi.fn();
    const s = state({ advancedOpen: true, selectedHour: 8, rangeEnd: 11 });
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), s, { ...noop, onBarKey, onSelectHour }));
    const bars = frag.querySelectorAll<HTMLButtonElement>(".es-bar");
    // The whole 08:00-11:00 span wears the selection outline.
    for (let h = 8; h <= 11; h++) expect(bars[h].classList.contains("sel")).toBe(true);
    expect(bars[7].classList.contains("sel")).toBe(false);
    expect(frag.textContent).toContain("Hours 08:00–11:00");
    const key = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    bars[9].dispatchEvent(key);
    expect(onBarKey).toHaveBeenCalledWith(9, "ArrowUp");
    expect(key.defaultPrevented).toBe(true);
  });

  it("draws one count gridline per car level behind the bars", () => {
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state({ advancedOpen: true }), noop));
    expect(frag.querySelectorAll(".es-gridline")).toHaveLength(3); // cars 4: lines at 1..3
  });

  it("the docked hour stepper edits the selected hour and clamps at 0 and the fleet", () => {
    const onHourStep = vi.fn();
    const s = state({ advancedOpen: true, selectedHour: 9 });
    s.schedule.activeCars.weekday![9] = 0;
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), s, { ...noop, onHourStep }));
    expect(frag.textContent).toContain("Hour 09:00");
    const step = frag.querySelector(".es-strip-step .es-stepper")!;
    const [minus, plus] = Array.from(step.querySelectorAll<HTMLButtonElement>("button"));
    expect(minus.disabled).toBe(true); // 0 cars: can't lower
    expect(step.textContent).toContain("0 cars");
    click(plus);
    expect(onHourStep).toHaveBeenCalledWith(1);
  });
});

describe("elevatorScheduleTemplate: day toggle and actions", () => {
  it("presses the live day and switches on click", () => {
    const onDay = vi.fn();
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state({ day: "weekend" }), { ...noop, onDay }));
    const [wd, we] = Array.from(frag.querySelectorAll(".es-day .btn"));
    expect(we.classList.contains("es-on")).toBe(true);
    expect(we.getAttribute("aria-pressed")).toBe("true");
    expect(wd.classList.contains("es-on")).toBe(false);
    click(wd);
    expect(onDay).toHaveBeenCalledWith("weekday");
  });

  it("keeps the Simulate readout a polite live region and offers OK / Cancel", () => {
    const onOk = vi.fn();
    const onCancel = vi.fn();
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state(), { ...noop, onOk, onCancel }));
    const sim = frag.querySelector(".es-sim")!;
    expect(sim.getAttribute("aria-live")).toBe("polite");
    expect(sim.textContent).toContain("Busiest weekday hour 17:00");
    click(frag.querySelector('[data-act="apply"]')!);
    click(frag.querySelector('[data-act="close"]')!);
    expect(onOk).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
