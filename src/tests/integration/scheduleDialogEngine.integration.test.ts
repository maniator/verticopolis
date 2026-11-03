import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import type { ScheduleDialogCtx } from "../../ui/uiElevatorSchedule";
import type { PresetProposal, ScheduleFacts } from "../../simport/enginePort";
import { referenceEngine } from "../fixtures/autoTuneDouble";

/**
 * What the schedule dialog does with the engine's advice, staging and preset
 * answers (#1552). The answers themselves are pinned in
 * `scheduleAuthoring.integration.test.ts` against the Rust engine; here the
 * engine is a stub that answers whatever each test needs, so the dialog is
 * shown to read the answer and nothing else: no hour math, no preset
 * building, no recommendation of its own.
 */

const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;
const press = (sel: string): void => dialog().querySelector<HTMLButtonElement>(sel)!.click();
const text = (sel: string): string | undefined => dialog().querySelector(sel)?.textContent ?? undefined;
const byLabel = (sel: string, label: string): HTMLButtonElement =>
  Array.from(dialog().querySelectorAll<HTMLButtonElement>(sel)).find((b) => b.textContent === label)!;

const stops = () => ({
  read: () => [4, 3, 2, 1].map((floor) => ({ floor, served: true, lobby: floor === 1, endpoint: floor === 1 || floor === 4 })),
  setServe: vi.fn(async () => {}),
  expressStops: vi.fn(async () => {}),
  allStops: vi.fn(async () => {}),
});

const FACTS: ScheduleFacts = {
  status: "available",
  recommended: "rush",
  advice: { status: "ready", over: [], short: [] },
  staging: { measured: true, peakHour: 8, activeAtPeak: 4, upTowerCars: 1, lobbyCars: 3, topLobby: 4, baseLobby: 1 },
  homeFloors: [1, 1, 1, 1],
};

/** An engine that keeps the homes it is handed, as the real one does on served floors. */
const echoHomes = (): ScheduleDialogCtx["facts"] => (draft) => ({ ...FACTS, homeFloors: draft.homeFloors ?? FACTS.homeFloors });

const PRESET: PresetProposal = {
  status: "available",
  weekday: Array(24).fill(2),
  weekend: Array(24).fill(3),
  homeFloors: [4, 4, 4, 4],
};

function ctx(over: Partial<ScheduleDialogCtx> = {}): ScheduleDialogCtx {
  const base = { cars: 4, bottom: 1, top: 4, stops: stops(), isExpress: false };
  return {
    title: "Schedule: Standard elevator (floors 1-4)",
    ux: MODERN_RULES.elevatorScheduleUX(),
    ...base,
    ...referenceEngine(base, true),
    facts: echoHomes(),
    preset: () => PRESET,
    initialWeekend: false,
    ...over,
  };
}

function open(over: Partial<ScheduleDialogCtx> = {}) {
  const { ui } = makeUI();
  const apply = vi.fn(async (_s: any) => {});
  const announce = vi.fn();
  ui.showElevatorScheduleDialog(ctx({ announce, ...over }), { apply });
  return { apply, announce };
}

beforeEach(() => mountAppDom());

describe("the dialog's advice comes from the engine's facts", () => {
  it("words the over and short hours and unfolds the strip", () => {
    open({ facts: () => ({ ...FACTS, advice: { status: "ready", over: [9, 10], short: [8] } }) });
    expect(text(".es-advice")).toBe("This shaft is over-staffed 09:00–10:00 and short at 08:00 on weekdays.");
  });

  it("says the schedule and the demand line up when the engine finds nothing off", () => {
    open();
    expect(text(".es-advice")).toBe("Measured demand and your schedule line up.");
  });

  it("shows no advice while the day is cold", () => {
    open({ facts: () => ({ ...FACTS, advice: { status: "insufficient-data", over: [], short: [] } }) });
    expect(dialog().querySelector(".es-advice")).toBeNull();
  });

  it("shows no advice where the mode withholds it, whatever the engine says", () => {
    open({ ux: CLASSIC_RULES.elevatorScheduleUX(), facts: () => ({ ...FACTS, advice: { status: "ready", over: [9], short: [] } }) });
    expect(dialog().querySelector(".es-advice")).toBeNull();
  });

  it("asks with the whole working copy, homes included, and the day tab on screen", () => {
    type Draft = { homeFloors?: number[]; activeCars?: { weekday?: number[] } };
    const facts = vi.fn((_draft: Draft, _weekend: boolean) => FACTS);
    open({ facts: facts as unknown as ScheduleDialogCtx["facts"] });
    const [draft, weekend] = facts.mock.calls[facts.mock.calls.length - 1];
    expect(draft.homeFloors).toEqual([1, 1, 1, 1]);
    expect(draft.activeCars?.weekday).toHaveLength(24);
    expect(weekend).toBe(false);
    byLabel("button", "Weekend").click();
    expect(facts.mock.calls[facts.mock.calls.length - 1][1]).toBe(true);
  });
});

describe("the dialog's staging sentence comes from the engine's summary", () => {
  it("leads with the measured busiest hour and the engine's counts", () => {
    open();
    expect(text(".es-sim")).toBe("Busiest weekday hour 08:00: 1 staged up-tower, 3 at the lobby, 4 of 4 cars on shift.");
  });

  it("names the assumed down-rush when the engine says the peak is not measured", () => {
    open({ facts: () => ({ ...FACTS, staging: { ...FACTS.staging!, measured: false, peakHour: 17, activeAtPeak: 2, upTowerCars: 0, lobbyCars: 2 } }) });
    expect(text(".es-sim")).toBe("No measured weekday peak yet; at the 17:00 down-rush: 0 staged up-tower, 2 at the lobby, 2 of 4 cars on shift.");
  });

  it("writes nothing when the engine has no summary", () => {
    open({ facts: () => ({ ...FACTS, status: "missing-shaft", staging: null }) });
    expect(text(".es-sim")).toBe("");
  });
});

describe("the dialog's presets come from the engine", () => {
  it("highlights the engine's recommendation", () => {
    open({ facts: () => ({ ...FACTS, recommended: "feeder" }) });
    expect(dialog().querySelector(".es-presets .es-rec")?.textContent).toBe("Feeder");
  });

  it("highlights none when the engine recommends none", () => {
    open({ facts: () => ({ ...FACTS, recommended: null }) });
    expect(dialog().querySelector(".es-presets .es-rec")).toBeNull();
  });

  it("asks for the preset by name and applies the rows it is given", () => {
    const preset = vi.fn(() => PRESET);
    const { apply, announce } = open({ preset });
    byLabel(".es-presets .btn", "Balanced").click();
    expect(preset).toHaveBeenCalledWith("balanced");
    expect(announce).toHaveBeenCalledWith("Applied the Balanced schedule.");
    press('[data-act="apply"]');
    const saved = apply.mock.calls[0][0];
    expect(saved.activeCars.weekday).toEqual(Array(24).fill(2));
    expect(saved.activeCars.weekend).toEqual(Array(24).fill(3));
    // Untouched staging takes the preset's homes.
    expect(saved.homeFloors).toEqual([4, 4, 4, 4]);
  });

  it("applies nothing, quietly, when the engine refuses the preset", () => {
    const { apply, announce } = open({ preset: () => ({ status: "unavailable-in-mode", weekday: null, weekend: null, homeFloors: [] }) });
    byLabel(".es-presets .btn", "Rush").click();
    expect(announce).not.toHaveBeenCalled();
    press('[data-act="apply"]');
    expect(apply.mock.calls[0][0].activeCars.weekday).toEqual(Array(24).fill(4));
    expect(apply.mock.calls[0][0].homeFloors).toEqual([1, 1, 1, 1]);
  });

  it("stages up-tower from the engine's staging play, in either mode", () => {
    const preset = vi.fn((): PresetProposal => ({ status: "available", weekday: null, weekend: null, homeFloors: [1, 1, 4, 4] }));
    const { apply } = open({ ux: CLASSIC_RULES.elevatorScheduleUX(), preset });
    byLabel("button", "Stage upper half up-tower").click();
    expect(preset).toHaveBeenCalledWith("stage-up-tower");
    press('[data-act="apply"]');
    expect(apply.mock.calls[0][0].homeFloors).toEqual([1, 1, 4, 4]);
  });

  it("leaves the staging alone when the engine has no staging play to give", () => {
    const { apply } = open({ preset: () => ({ status: "missing-shaft", weekday: null, weekend: null, homeFloors: [] }) });
    byLabel("button", "Stage upper half up-tower").click();
    press('[data-act="apply"]');
    expect(apply.mock.calls[0][0].homeFloors).toEqual([1, 1, 1, 1]);
  });
});

describe("the dialog's staging comes from the engine's homes and base", () => {
  it("opens on the homes the engine answers for the saved schedule", () => {
    const facts = vi.fn((draft: { homeFloors?: number[] }) => ({ ...FACTS, homeFloors: draft.homeFloors ? [2, 2, 3, 4] : [1, 1, 1, 1] }));
    const { apply } = open({ current: { homeFloors: [9, 9, 9, 9] }, facts: facts as unknown as ScheduleDialogCtx["facts"] });
    // The saved homes went to the engine, which put them on served floors.
    expect(facts.mock.calls[0][0].homeFloors).toEqual([9, 9, 9, 9]);
    press('[data-act="apply"]');
    expect(apply.mock.calls[0][0].homeFloors).toEqual([2, 2, 3, 4]);
  });

  it("takes the base floor from the engine's summary", () => {
    open({ facts: () => ({ ...FACTS, staging: { ...FACTS.staging!, baseLobby: 3 } }) });
    expect(byLabel("button", "Home all cars at Floor 3")).toBeDefined();
    expect(dialog().querySelector(".es-base")).not.toBeNull();
  });

  it("repoints every car at the engine's base floor", () => {
    const { apply } = open({ facts: (draft) => ({ ...FACTS, staging: { ...FACTS.staging!, baseLobby: 3 }, homeFloors: draft.homeFloors ?? [3, 3, 3, 3] }) });
    byLabel("button", "Home all cars at Floor 3").click();
    press('[data-act="apply"]');
    expect(apply.mock.calls[0][0].homeFloors).toEqual([3, 3, 3, 3]);
  });
});
