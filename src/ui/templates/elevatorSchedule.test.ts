import { describe, it, expect, vi } from "vitest";
import {
  elevatorScheduleTemplate,
  floorLabel,
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
  onServe: () => {},
  onExpressStops: () => {},
  onAllStops: () => {},
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
  hasMeasured: true,
  recommended: "rush",
  ...over,
});

const state = (over: Partial<SchedState> = {}): SchedState => ({
  day: "weekday",
  selectedHour: 17,
  rangeEnd: null,
  advancedOpen: false,
  cancelArmed: false,
  floors: [
    { floor: 4, served: true, lobby: false },
    { floor: 3, served: true, lobby: false },
    { floor: 2, served: false, lobby: false },
    { floor: 1, served: true, lobby: true },
  ],
  base: 1,
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

describe("elevatorScheduleTemplate: floors grid (the fold-in surface)", () => {
  it("renders one row per span floor descending, with Serve toggles and the base marker", () => {
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state(), noop));
    const rows = frag.querySelectorAll(".es-grid-row:not(.es-grid-head)");
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("4"); // descending: top floor first
    expect(rows[3].querySelector(".es-base")).not.toBeNull(); // base marker on floor 1
    expect(rows[3].querySelector(".es-lobby-mark")).not.toBeNull();
    const serve = rows[2].querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(serve.checked).toBe(false); // floor 2 is skipped
    expect(rows[2].classList.contains("es-skipped")).toBe(true);
    expect(rows[2].querySelectorAll(".es-chip")).toHaveLength(0); // no chips on a skipped row
  });

  it("marks each car's home with a pressed numbered chip and wires chip presses", () => {
    const onHomeSet = vi.fn();
    const frag = renderToFragment(
      elevatorScheduleTemplate(ctx(), state({ schedule: { ...state().schedule, homeFloors: [1, 1, 4, 4] } }), { ...noop, onHomeSet }),
    );
    const rows = frag.querySelectorAll(".es-grid-row:not(.es-grid-head)");
    const topChips = rows[0].querySelectorAll<HTMLButtonElement>(".es-chip");
    expect(topChips).toHaveLength(4); // every served row offers every car
    expect(topChips[2].classList.contains("on")).toBe(true); // car 3 homes at 4
    expect(topChips[0].classList.contains("on")).toBe(false);
    click(rows[1].querySelectorAll(".es-chip")[1]); // press car 2's chip on floor 3
    expect(onHomeSet).toHaveBeenCalledWith(1, 3);
  });

  it("wires the folded-in Serve toggle and bulk stop actions", () => {
    const onServe = vi.fn();
    const onExpressStops = vi.fn();
    const onAllStops = vi.fn();
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state(), { ...noop, onServe, onExpressStops, onAllStops }));
    const serve = frag.querySelectorAll(".es-grid-row:not(.es-grid-head)")[0].querySelector<HTMLInputElement>("input[type=checkbox]")!;
    serve.checked = false;
    change(serve);
    expect(onServe).toHaveBeenCalledWith(4, false);
    const quick = frag.querySelectorAll<HTMLButtonElement>(".es-quick .btn");
    expect(quick[0].textContent).toBe("Express (lobbies)");
    expect(quick[1].textContent).toBe("All stops");
    click(quick[0]);
    click(quick[1]);
    expect(onExpressStops).toHaveBeenCalledOnce();
    expect(onAllStops).toHaveBeenCalledOnce();
  });

  it("names the base floor in the home-all quick action when it is not the ground lobby", () => {
    const s = state({ base: 15 });
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), s, noop));
    expect(frag.textContent).toContain("Home all cars at Floor 15");
  });

  it("express renders the caption and no Serve column or bulk stop buttons", () => {
    const frag = renderToFragment(elevatorScheduleTemplate(ctx({ isExpress: true }), state(), noop));
    expect(frag.textContent).toContain("Serves all lobbies and sky lobbies");
    expect(frag.querySelector(".es-grid input[type=checkbox]")).toBeNull();
    const quick = Array.from(frag.querySelectorAll<HTMLButtonElement>(".es-quick .btn")).map((b) => b.textContent);
    expect(quick).not.toContain("Express (lobbies)");
    expect(quick).not.toContain("All stops");
  });

  it("the editor card retirement is total: no Configure stops surface remains", () => {
    // The dialog is now the one stops surface; the grid must carry the pinned
    // column heads from the copy inventory.
    const frag = renderToFragment(elevatorScheduleTemplate(ctx(), state(), noop));
    expect(frag.querySelector(".es-grid-head")!.textContent).toContain("Floor");
    expect(frag.querySelector(".es-grid-head")!.textContent).toContain("Serve");
    expect(frag.querySelector(".es-grid-head")!.textContent).toContain("Home car(s)");
  });
});

describe("floorLabel", () => {
  it("keeps the retired stops dialog's basement grammar: B1 below ground, plain above", () => {
    expect(floorLabel(5)).toBe("5");
    expect(floorLabel(1)).toBe("1");
    expect(floorLabel(0)).toBe("B1");
    expect(floorLabel(-2)).toBe("B3");
  });
});

describe("elevatorScheduleTemplate: ghost series", () => {
  it("draws a demand tick per hour and grays the authored fill above the measured line", () => {
    const hourly = Array(24).fill(0.5);
    const frag = renderToFragment(elevatorScheduleTemplate(ctx({ hourly }), state({ advancedOpen: true }), noop));
    const bars = frag.querySelectorAll(".es-bar");
    expect(bars[9].querySelector(".es-bar-demand")).not.toBeNull();
    // Authored 4 of 4 (100%) against measured 50%: the top half grays as spare.
    expect(bars[9].querySelector(".es-bar-over")).not.toBeNull();
    expect(frag.textContent).toContain("Dashes mark measured demand");
  });

  it("renders no ghost machinery before the shaft warms up", () => {
    const frag = renderToFragment(elevatorScheduleTemplate(ctx({ hourly: undefined }), state({ advancedOpen: true }), noop));
    expect(frag.querySelector(".es-bar-demand")).toBeNull();
    expect(frag.querySelector(".es-bar-over")).toBeNull();
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
