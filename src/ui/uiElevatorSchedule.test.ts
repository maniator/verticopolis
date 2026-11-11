// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { AutoTuneProposal, PresetProposal, ScheduleFacts } from "../simport/enginePort";
import {
  CARS,
  CLASSIC_UX,
  COLD_DAY,
  FACTS,
  PRESET,
  TUNE_COLD,
  TUNE_WEEKDAY,
  WARM_DAY,
  button,
  cancel,
  chipAt,
  dialog,
  flush,
  homesShown,
  lastAnnounce,
  ok,
  open,
  press,
  q,
  row,
  saved,
  stopsPort,
  text,
} from "./uiElevatorSchedule.fixture";

/**
 * The schedule dialog against canned engine answers: what it asks the engine
 * (`autoTune`, `facts`, `preset`) and what it does with each answer. The edits
 * (strip, steppers, stops, chips, OK and Cancel) live in
 * `uiElevatorScheduleEdits.test.ts`.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

const WEEKDAY_SIM = "Busiest weekday hour 08:00: 1 staged up-tower, 3 at the lobby, 4 of 4 cars on shift.";

const withAdvice = (over: number[], short: number[]): ScheduleFacts => ({ ...FACTS, advice: { status: "ready", over, short } });
const REFUSED_FACTS: ScheduleFacts = {
  status: "missing-shaft",
  recommended: null,
  advice: { status: "refused", over: [], short: [] },
  staging: null,
  homeFloors: [],
};
const origins = (peak: Map<number, number>) => ({
  weekday: Array.from({ length: 24 }, (_, h) => (h === 8 ? peak : new Map<number, number>())),
  weekend: Array.from({ length: 24 }, () => new Map<number, number>()),
});

describe("opening the dialog", () => {
  it("asks the engine for a tune, the seed homes and the working facts, on the weekday tab", () => {
    const { ctx } = open();
    expect(ctx.autoTune).toHaveBeenCalledTimes(2);
    expect(ctx.autoTune.mock.calls[0]).toEqual([{}, false]);
    // The first recompute hands over no homes: the player has not staged by hand.
    expect(ctx.autoTune.mock.calls[1][1]).toBe(false);
    expect(ctx.autoTune.mock.calls[1][0].homeFloors).toBeUndefined();
    expect(ctx.facts).toHaveBeenCalledTimes(2);
    expect(ctx.facts.mock.calls[0]).toEqual([{ homeFloors: undefined }, false]);
    expect(ctx.facts.mock.calls[1][0]).toEqual({
      activeCars: { weekday: row(CARS), weekend: row(CARS) },
      homeFloors: [1, 1, 1, 1],
      waitingCarResponse: 0,
      standardFloorDeparture: 48,
    });
    expect(ctx.preset).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
    expect(text("h2")).toContain("Schedule: Standard elevator (floors 1-4)");
    expect(q(".es-day .es-on")?.textContent).toBe("Weekday");
    expect(homesShown()).toEqual(["1:1", "1:2", "1:3", "1:4"]);
  });

  it("opens on the weekend tab with the weekend flag on every query", () => {
    const { ctx } = open({ initialWeekend: true, ux: CLASSIC_UX });
    expect(ctx.autoTune.mock.calls.map((c) => c[1])).toEqual([true, true]);
    expect(ctx.facts.mock.calls.map((c) => c[1])).toEqual([true, true]);
    expect(q(".es-day .es-on")?.textContent).toBe("Weekend");
    expect(q(".es-bar.sel")?.getAttribute("aria-label")).toBe("weekend 12:00, 4 of 4 cars");
    expect(text(".es-sim")).toBe("Busiest weekend hour 08:00: 1 staged up-tower, 3 at the lobby, 4 of 4 cars on shift.");
  });

  it("seeds the working copy from the stored schedule, clamping counts and keeping its tunables", () => {
    const current = {
      activeCars: { weekday: [9, -2, 2.7, Number.NaN], weekend: row(1) },
      homeFloors: [3, Number.NaN],
      waitingCarResponse: 7,
      standardFloorDeparture: 20,
    };
    const { ctx, apply } = open({ current, ux: CLASSIC_UX });
    // The seed query reads a copy of the stored homes.
    expect(ctx.facts.mock.calls[0]).toEqual([{ homeFloors: [3, Number.NaN] }, false]);
    // The seed answered no homes, so the readable stored home stays and the rest wait at the base.
    expect(homesShown()).toEqual(["3:1", "1:2", "1:3", "1:4"]);
    // Stored homes count as hand-set: the engine sees them in the draft.
    expect(ctx.autoTune.mock.calls[1][0].homeFloors).toEqual([3, 1, 1, 1]);
    ok();
    const s = saved(apply);
    expect(s.activeCars.weekday.slice(0, 5)).toEqual([4, 0, 2, 4, 4]);
    expect(s.activeCars.weekend).toEqual(row(1));
    expect(s.waitingCarResponse).toBe(7);
    expect(s.standardFloorDeparture).toBe(20);
  });

  it("takes the seed's homes when the engine answers one per car", () => {
    open({ facts: { ...FACTS, homeFloors: [2, 2, 3, 3] } });
    expect(homesShown()).toEqual(["3:3", "3:4", "2:1", "2:2"]);
  });
});

describe("the advice line", () => {
  it("says the schedule lines up when the ready advice lists nothing", () => {
    open();
    expect(text(".es-advice")).toBe("Measured demand and your schedule line up.");
    expect(q("details.es-adv")?.hasAttribute("open")).toBe(false);
  });

  it("words over and short hours as ranges and unfolds the strip it critiques", () => {
    const { ctx } = open();
    ctx.facts.mockReturnValue(withAdvice([9, 10, 11], [17]));
    press(".es-allcars");
    expect(text(".es-advice")).toBe("This shaft is over-staffed 09:00–11:00 and short at 17:00 on weekdays.");
    expect(q("details.es-adv")?.hasAttribute("open")).toBe(true);
    expect(dialog().querySelectorAll(".es-bar")).toHaveLength(24);
  });

  it("opens already unfolded on a critical shaft and names each clause alone", () => {
    open({ facts: withAdvice([9, 13], []) });
    expect(text(".es-advice")).toBe("This shaft is over-staffed 09:00, 13:00 on weekdays.");
    expect(q("details.es-adv")?.hasAttribute("open")).toBe(true);
    document.body.innerHTML = "";
    open({ facts: withAdvice([], [7]), initialWeekend: true });
    expect(text(".es-advice")).toBe("This shaft is short at 07:00 on weekends.");
  });

  it.each(["insufficient-data", "no-cars", "unavailable-in-mode", "refused"] as const)("shows no advice while it is %s", (status) => {
    open({ facts: { ...FACTS, advice: { status, over: [], short: [] } } });
    expect(q(".es-advice")).toBeNull();
    expect(q("details.es-adv")?.hasAttribute("open")).toBe(false);
  });

  it("withholds advice in Classic, which shows the raw grid outright", () => {
    open({ ux: CLASSIC_UX, facts: withAdvice([9], []) });
    expect(q(".es-advice")).toBeNull();
    expect(q(".es-presets")).toBeNull();
    expect(q("details.es-adv")).toBeNull();
    expect(dialog().querySelectorAll(".es-bar")).toHaveLength(24);
  });
});

describe("the staging sentence", () => {
  it("summarizes the measured peak, the staging counts and the shift", () => {
    open();
    expect(text(".es-sim")).toBe(WEEKDAY_SIM);
  });

  it("names the assumed down-rush on a day with no measured peak", () => {
    open({ facts: { ...FACTS, staging: { ...FACTS.staging!, measured: false, peakHour: 17 } } });
    expect(text(".es-sim")).toBe("No measured weekday peak yet; at the 17:00 down-rush: 1 staged up-tower, 3 at the lobby, 4 of 4 cars on shift.");
  });

  it("names a basement base with the B-n grammar and homes unhomed cars there", () => {
    const facts = ({ ...FACTS, staging: { ...FACTS.staging!, baseLobby: 0 } });
    open({ facts, bottom: -1, stops: stopsPort(2, [0], [], -1) });
    expect(text(".es-sim")).toBe("Busiest weekday hour 08:00: 1 staged up-tower, 3 at Floor B1 (the base), 4 of 4 cars on shift.");
    expect(homesShown()).toEqual(["B1:1", "B1:2", "B1:3", "B1:4"]);
    expect(button("Home all cars at Floor B1")).toBeDefined();
    const baseRow = q(".es-base")!.closest(".es-grid-row")!;
    expect(baseRow.querySelector(".es-cell-floor")?.textContent).toContain("B1");
    expect(baseRow.querySelector(".es-lobby-mark")).not.toBeNull();
  });

  it("stays empty when the engine refuses the facts, falling back to the shaft bottom", () => {
    open({ facts: REFUSED_FACTS, bottom: 2, stops: stopsPort(4, [], [], 2) });
    expect(text(".es-sim")).toBe("");
    expect(q(".es-advice")).toBeNull();
    expect(q(".es-presets .es-rec")).toBeNull();
    expect(homesShown()).toEqual(["2:1", "2:2", "2:3", "2:4"]);
  });

  it("adopts the homes the engine answers on every recompute", () => {
    const { ctx } = open();
    ctx.facts.mockReturnValue({ ...FACTS, homeFloors: [4, 4, 4, 4] });
    press(".es-allcars");
    expect(homesShown()).toEqual(["4:1", "4:2", "4:3", "4:4"]);
  });
});

describe("origin hotspots", () => {
  it("marks one hotspot floor and names it", () => {
    open({ autoTune: TUNE_WEEKDAY, origins: origins(new Map([[3, 10]])) });
    expect(text(".es-sim")).toBe(`${WEEKDAY_SIM} Most riders board at Floor 3.`);
    expect(q(".es-origin")?.closest(".es-cell-floor")?.textContent).toBe("3▲");
  });

  it("reads a contiguous band as a range and scattered floors as a list", () => {
    open({ autoTune: TUNE_WEEKDAY, origins: origins(new Map([[2, 50], [3, 40], [4, 10]])) });
    expect(text(".es-sim")).toBe(`${WEEKDAY_SIM} Most riders board on floors 2–3.`);
    expect(dialog().querySelectorAll(".es-origin")).toHaveLength(2);
    document.body.innerHTML = "";
    open({ autoTune: TUNE_WEEKDAY, origins: origins(new Map([[1, 50], [4, 50]])) });
    expect(text(".es-sim")).toBe(`${WEEKDAY_SIM} Most riders board on floors 1, 4.`);
  });

  it("marks nothing while the day is cold", () => {
    open({ origins: origins(new Map([[3, 10]])) });
    expect(text(".es-sim")).toBe(WEEKDAY_SIM);
    expect(q(".es-origin")).toBeNull();
  });

  it("ranks only served floors, so a skipped floor's mass does not hide the rest", async () => {
    open({ autoTune: TUNE_WEEKDAY, origins: origins(new Map([[3, 90], [2, 10]])) });
    expect(text(".es-sim")).toBe(`${WEEKDAY_SIM} Most riders board at Floor 3.`);
    const box = q<HTMLInputElement>('input[aria-label="Serve floor 3"]')!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await flush();
    expect(text(".es-sim")).toBe(`${WEEKDAY_SIM} Most riders board at Floor 2.`);
  });
});

describe("presets", () => {
  it("highlights the preset the engine recommends", () => {
    open({ facts: { ...FACTS, recommended: "balanced" } });
    const rec = q(".es-presets .es-rec");
    expect(rec?.textContent?.trim()).toBe("Balanced");
    expect(rec?.getAttribute("title")).toBe("Recommended for this shaft");
    expect(dialog().querySelectorAll(".es-presets .es-rec")).toHaveLength(1);
  });

  it("applies a preset's rows and homes and announces it", () => {
    const { ctx, apply } = open();
    button("Feeder").click();
    expect(ctx.preset).toHaveBeenCalledWith("feeder");
    expect(lastAnnounce(ctx)).toBe("Applied the Feeder schedule.");
    expect(homesShown()).toEqual(["4:1", "4:2", "4:3", "4:4"]);
    expect(q(".modal-warn")?.textContent).toBe("You have unsaved changes.");
    ok();
    expect(saved(apply)).toEqual({ activeCars: { weekday: row(2), weekend: row(3) }, homeFloors: [4, 4, 4, 4], waitingCarResponse: 0, standardFloorDeparture: 48 });
  });

  it("fills a day the preset leaves out with the whole fleet", () => {
    const { ctx, apply } = open({ preset: { ...PRESET, weekday: null, weekend: null } });
    button("Rush").click();
    expect(lastAnnounce(ctx)).toBe("Applied the Rush schedule.");
    ok();
    expect(saved(apply).activeCars).toEqual({ weekday: row(CARS), weekend: row(CARS) });
  });

  it("keeps homes the player set by hand", () => {
    const { ctx, apply } = open();
    chipAt(2, 1).click();
    button("Balanced").click();
    expect(lastAnnounce(ctx)).toBe("Applied the Balanced schedule.");
    ok();
    expect(saved(apply).homeFloors).toEqual([2, 1, 1, 1]);
    expect(saved(apply).activeCars.weekday).toEqual(row(2));
  });

  it("does nothing when the engine refuses the preset", () => {
    const refused: PresetProposal = { status: "unavailable-in-mode", weekday: null, weekend: null, homeFloors: [] };
    const { ctx } = open({ preset: refused });
    const before = ctx.facts.mock.calls.length;
    button("Rush").click();
    button("Stage upper half up-tower").click();
    expect(ctx.preset.mock.calls).toEqual([["rush"], ["stage-up-tower"]]);
    expect(ctx.facts.mock.calls.length).toBe(before);
    expect(ctx.announce).not.toHaveBeenCalled();
    expect(q(".modal-warn")).toBeNull();
  });

  it("stages the upper half up-tower from the engine's homes", () => {
    const stage: PresetProposal = { status: "available", weekday: null, weekend: null, homeFloors: [3, 3, 4, 4] };
    const { ctx, apply } = open({ preset: stage });
    button("Stage upper half up-tower").click();
    expect(ctx.preset).toHaveBeenCalledWith("stage-up-tower");
    expect(homesShown()).toEqual(["4:3", "4:4", "3:1", "3:2"]);
    // Staged homes count as hand-set: the next query hands them over.
    expect(ctx.autoTune.mock.lastCall![0].homeFloors).toEqual([3, 3, 4, 4]);
    ok();
    expect(saved(apply).activeCars.weekday).toEqual(row(CARS));
  });
});

describe("Auto-tune", () => {
  it("is disabled with a hint while no day is warm", () => {
    open();
    expect(q<HTMLButtonElement>(".es-autotune")?.disabled).toBe(true);
    expect(Array.from(dialog().querySelectorAll(".es-hint")).map((p) => p.textContent)).toContain("Auto-tune needs a day or two of measured traffic first.");
  });

  it("explains a shaft with no cars", () => {
    open({ autoTune: { ...TUNE_COLD, status: "no-cars" } });
    expect(q<HTMLButtonElement>(".es-autotune")?.disabled).toBe(true);
    expect(Array.from(dialog().querySelectorAll(".es-hint")).map((p) => p.textContent)).toContain("This shaft has no cars to tune.");
  });

  it("is not offered in Classic", () => {
    open({ ux: CLASSIC_UX, autoTune: TUNE_WEEKDAY });
    expect(q(".es-autotune")).toBeNull();
  });

  it("applies the proposal against an untouched draft, keeping the untuned day's own row", () => {
    const current = { activeCars: { weekday: row(CARS), weekend: row(1) } };
    const { ctx, apply } = open({ current, autoTune: TUNE_WEEKDAY });
    expect(q<HTMLButtonElement>(".es-autotune")?.disabled).toBe(false);
    const asked = ctx.autoTune.mock.calls.length;
    press(".es-autotune");
    expect(ctx.autoTune.mock.calls[asked][0].homeFloors).toBeUndefined();
    expect(ctx.autoTune.mock.calls[asked][1]).toBe(false);
    expect(lastAnnounce(ctx)).toBe("Auto-tuned the weekday schedule and staging to measured demand.");
    expect(homesShown()).toEqual(["4:3", "4:4", "1:1", "1:2"]);
    ok();
    expect(saved(apply).activeCars).toEqual({ weekday: TUNE_WEEKDAY.proposal!.weekday, weekend: row(1) });
    expect(saved(apply).homeFloors).toEqual([1, 1, 4, 4]);
  });

  it("hands over hand-set homes and names both days when both were tuned", () => {
    const both: AutoTuneProposal = {
      status: "available",
      weekday: WARM_DAY,
      weekend: WARM_DAY,
      proposal: { weekday: null, weekend: row(1), homeFloors: [1, 2, 3, 4], homesSeeded: false },
    };
    const current = { activeCars: { weekday: row(3), weekend: row(CARS) } };
    const { ctx, apply } = open({ current, autoTune: both, initialWeekend: true });
    chipAt(2, 2).click();
    const asked = ctx.autoTune.mock.calls.length;
    press(".es-autotune");
    expect(ctx.autoTune.mock.calls[asked][0].homeFloors).toEqual([1, 2, 1, 1]);
    expect(ctx.autoTune.mock.calls[asked][1]).toBe(true);
    expect(lastAnnounce(ctx)).toBe("Auto-tuned the weekday and weekend schedules and staging to measured demand.");
    ok();
    expect(saved(apply).activeCars).toEqual({ weekday: row(3), weekend: row(1) });
  });

  it("asks for more traffic when the shaft has cooled by the time it is pressed", () => {
    const { ctx, apply } = open({ autoTune: TUNE_WEEKDAY });
    ctx.autoTune.mockReturnValue(TUNE_COLD);
    press(".es-autotune");
    expect(lastAnnounce(ctx)).toBe("Auto-tune needs a day or two of measured traffic first.");
    expect(q(".modal-warn")).toBeNull();
    ok();
    expect(saved(apply).activeCars.weekday).toEqual(row(CARS));
  });

  it("stays quiet on any other refusal", () => {
    const { ctx } = open({ autoTune: TUNE_WEEKDAY });
    ctx.autoTune.mockReturnValue({ ...TUNE_COLD, status: "missing-shaft" });
    press(".es-autotune");
    expect(ctx.announce).not.toHaveBeenCalled();
    expect(q(".modal-warn")).toBeNull();
  });

  it("draws the measured ghost on a warm day and hints on a cold one", () => {
    open({ autoTune: TUNE_WEEKDAY });
    q("details.es-adv summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(dialog().querySelectorAll(".es-bar-demand")).toHaveLength(24);
    // Every hour but the 08:00 peak runs more cars than measured demand wants.
    expect(dialog().querySelectorAll(".es-bar-over")).toHaveLength(23);
    expect(q(".es-legend")).not.toBeNull();
    button("Weekend").click();
    expect(q(".es-bar-demand")).toBeNull();
    expect(q(".es-legend")).toBeNull();
    expect(Array.from(dialog().querySelectorAll(".es-hint")).map((p) => p.textContent)).toContain(
      "No measured weekend traffic yet; Auto-tune adjusts only measured days.",
    );
  });

  it("picks up a day that warms while the dialog is open", () => {
    const { ctx } = open();
    ctx.autoTune.mockReturnValue({ ...TUNE_WEEKDAY, weekday: { ...COLD_DAY }, weekend: WARM_DAY });
    button("Weekend").click();
    expect(q<HTMLButtonElement>(".es-autotune")?.disabled).toBe(false);
    expect(ctx.autoTune.mock.lastCall![1]).toBe(true);
    cancel();
    expect(dialog().open).toBe(false);
  });
});

describe("closing", () => {
  it("lets a stop edit settle without repainting a closed dialog", async () => {
    const { ctx } = open();
    const box = q<HTMLInputElement>('input[aria-label="Serve floor 2"]')!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    cancel();
    await flush();
    expect(ctx.stops.setServe).toHaveBeenCalledWith(2, false);
    expect(ctx.stops.read).toHaveBeenCalledTimes(1);
    expect(ctx.announce).not.toHaveBeenCalled();
  });
});
