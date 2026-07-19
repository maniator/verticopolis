import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GameApp } from "../main";
import { SPEEDS, runFrame, emitMealRushes } from "./frameLoop";
import { decideMealRush } from "./mealRush";

/**
 * These pin the per-frame simulation + throttled UI/audio refresh (`runFrame`)
 * and the once-per-day meal-rush bulletins (`emitMealRushes`) against a
 * hand-built fake `GameApp`. The sibling collaborators are mocked so the tests
 * isolate frameLoop's own control flow (the freeze latch, the catch-up cap, the
 * ~6Hz throttle, the auto-surfaced modals):
 *   - `updateTraffic` / `positionPanels` / `maybeSurfaceUpdatePrompt` are inert
 *     spies (their behavior is pinned by their own colocated tests).
 *   - `decideMealRush` is a controllable spy so the meal-rush emission can be
 *     forced without restating its pure crossing math.
 * `paceFactor` stays the REAL function; `steadyClock: true` pins pace to 1 so
 * the accumulation math is exact and deterministic.
 */

vi.mock("./trafficHud", () => ({ updateTraffic: vi.fn() }));
vi.mock("./panelAnchoring", () => ({ positionPanels: vi.fn() }));
vi.mock("./updateFlow", () => ({ maybeSurfaceUpdatePrompt: vi.fn() }));
vi.mock("./mealRush", () => ({ decideMealRush: vi.fn() }));

interface FakeSim {
  clock: { minuteOfDay: number; minutes: number; calendar: { weekDays: number; weekendDays: number } };
  tick: ReturnType<typeof vi.fn>;
  star: number;
  pendingChoice: { message: string; cost: number } | null;
  evaluatedTower: boolean;
  resolveChoice: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  tower: { totalPopulation: ReturnType<typeof vi.fn> };
}

function makeSim(over: Partial<FakeSim> = {}): FakeSim {
  return {
    clock: { minuteOfDay: 0, minutes: 0, calendar: { weekDays: 7, weekendDays: 2 } },
    tick: vi.fn(),
    star: 1,
    pendingChoice: null,
    evaluatedTower: false,
    resolveChoice: vi.fn(),
    emit: vi.fn(),
    tower: { totalPopulation: vi.fn(() => 0) },
    ...over,
  };
}

function makeApp(over: Record<string, unknown> = {}) {
  const sim = (over.sim as FakeSim) ?? makeSim();
  const app = {
    shownChoice: false,
    shownUpdate: false,
    speed: 3,
    prefs: { steadyClock: true },
    sim,
    accMinutes: 0,
    audio: { update: vi.fn(), sfx: vi.fn() },
    engine: { focus: vi.fn(() => ({})) },
    ui: {
      update: vi.fn(),
      isEditorOpen: vi.fn(() => false),
      isEditorBusy: vi.fn(() => false),
      showEventChoice: vi.fn(),
      congratsTower: vi.fn(),
    },
    onboarding: { tick: vi.fn() },
    selected: null,
    refreshEditor: vi.fn(),
    // Far in the past so the ~6Hz throttle block always runs.
    lastUiUpdate: -1e9,
    lastStar: 1,
    shownWin: false,
    lastMealRushDay: { breakfast: -1, lunch: -1, dinner: -1 } as Record<string, number>,
    ...over,
  };
  return { app: app as unknown as GameApp, raw: app, sim };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SPEEDS", () => {
  it("maps the four speed indices to in-game minutes per real second", () => {
    expect(SPEEDS).toEqual([0, 10, 30, 120]);
  });
});

describe("runFrame freeze path", () => {
  it("freezes time (accMinutes -> 0, no tick) while an emergency choice modal is up", () => {
    const { app, raw, sim } = makeApp({ shownChoice: true, accMinutes: 12 });
    runFrame(app, 1000);
    expect(raw.accMinutes).toBe(0);
    expect(sim.tick).not.toHaveBeenCalled();
  });

  it("freezes time while the update prompt is up", () => {
    const { app, raw, sim } = makeApp({ shownUpdate: true, accMinutes: 9 });
    runFrame(app, 1000);
    expect(raw.accMinutes).toBe(0);
    expect(sim.tick).not.toHaveBeenCalled();
  });
});

describe("runFrame simulation stepping", () => {
  it("advances the sim in <=20-minute chunks and drains the accumulator", () => {
    // 0.2s at speed 3 (120 min/s), pace 1 -> 24 owed minutes (under the 30
    // catch-up cap) -> 20 + 4, fully drained.
    const { app, raw, sim } = makeApp({ speed: 3, accMinutes: 0 });
    runFrame(app, 200);
    const steps = sim.tick.mock.calls.map((c) => c[0] as number);
    expect(steps).toEqual([20, 4]);
    expect(steps.every((s) => s <= 20)).toBe(true);
    expect(raw.accMinutes).toBe(0);
  });

  it("clamps catch-up debt to MAX_CATCHUP (30 min) on a huge frame", () => {
    // A 100s frame at speed 3 would owe 12000 minutes; the cap drops it to 30,
    // simulated as 20 + 10 (each step still <= 20).
    const { app, raw, sim } = makeApp({ speed: 3, accMinutes: 0 });
    runFrame(app, 100_000);
    const steps = sim.tick.mock.calls.map((c) => c[0] as number);
    expect(steps).toEqual([20, 10]);
    expect(steps.reduce((a, b) => a + b, 0)).toBe(30); // total bounded to the cap
    expect(steps.every((s) => s <= 20)).toBe(true);
    expect(raw.accMinutes).toBe(0);
  });

  it("does not tick at speed 0", () => {
    const { app, sim } = makeApp({ speed: 0 });
    runFrame(app, 1000);
    expect(sim.tick).not.toHaveBeenCalled();
  });
});

describe("runFrame throttled UI/audio block", () => {
  it("refreshes ui/audio/onboarding when the ~6Hz window has elapsed", () => {
    const { app, raw } = makeApp({ speed: 0, lastUiUpdate: -1e9 });
    runFrame(app, 16);
    expect(raw.audio.update).toHaveBeenCalledTimes(1);
    expect(raw.ui.update).toHaveBeenCalledTimes(1);
    expect(raw.onboarding.tick).toHaveBeenCalledTimes(1);
    // The throttle stamps lastUiUpdate to "now" so the next close frame skips.
    expect(raw.lastUiUpdate).toBeGreaterThan(-1e9);
  });

  it("skips the throttled block when the last refresh was too recent", () => {
    const recent = (globalThis.performance ? performance.now() : 0) + 1e9;
    const { app, raw } = makeApp({ speed: 0, lastUiUpdate: recent });
    runFrame(app, 16);
    expect(raw.audio.update).not.toHaveBeenCalled();
    expect(raw.ui.update).not.toHaveBeenCalled();
  });

  it("refreshes the open editor's live stats only when one is open and idle", () => {
    const { app, raw } = makeApp({ speed: 0, selected: { id: 1 } });
    raw.ui.isEditorOpen = vi.fn(() => true);
    raw.ui.isEditorBusy = vi.fn(() => false);
    runFrame(app, 16);
    expect(raw.refreshEditor).toHaveBeenCalledTimes(1);
  });

  it("does not refresh the editor while it is mid-press (busy)", () => {
    const { app, raw } = makeApp({ speed: 0, selected: { id: 1 } });
    raw.ui.isEditorOpen = vi.fn(() => true);
    raw.ui.isEditorBusy = vi.fn(() => true);
    runFrame(app, 16);
    expect(raw.refreshEditor).not.toHaveBeenCalled();
  });
});

describe("runFrame star-promotion jingle", () => {
  it("plays the promote jingle when the star rises below the win", () => {
    const sim = makeSim({ star: 3 });
    const { app, raw } = makeApp({ speed: 0, sim, lastStar: 2 });
    runFrame(app, 16);
    expect(raw.audio.sfx).toHaveBeenCalledWith("promote");
    expect(raw.lastStar).toBe(3);
  });

  it("does NOT play the star jingle at star 6 (the TOWER win owns that)", () => {
    const sim = makeSim({ star: 6 });
    const { app, raw } = makeApp({ speed: 0, sim, lastStar: 5 });
    runFrame(app, 16);
    expect(raw.audio.sfx).not.toHaveBeenCalled();
    expect(raw.lastStar).toBe(6); // latch still advances
  });
});

describe("runFrame auto-surfaced emergency choice", () => {
  it("opens the event choice once and latches shownChoice", () => {
    const pc = { message: "Fire on floor 30!", cost: 5000 };
    const sim = makeSim({ pendingChoice: pc });
    const { app, raw } = makeApp({ speed: 0, sim });
    runFrame(app, 16);
    expect(raw.shownChoice).toBe(true);
    expect(raw.audio.sfx).toHaveBeenCalledWith("error");
    expect(raw.ui.showEventChoice).toHaveBeenCalledTimes(1);
    const [msg, cost, cb] = raw.ui.showEventChoice.mock.calls[0];
    expect(msg).toBe(pc.message);
    expect(cost).toBe("$5,000");
    // The callback resolves the choice on the sim and clears the latch.
    (cb as (opt: unknown) => void)("pay");
    expect(sim.resolveChoice).toHaveBeenCalledWith("pay");
    expect(raw.shownChoice).toBe(false);
  });

  it("does not open the choice behind the boot/return splash", () => {
    const sim = makeSim({ pendingChoice: { message: "Fire!", cost: 5000 } });
    const { app, raw } = makeApp({ speed: 0, sim });
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    runFrame(app, 16);
    expect(raw.ui.showEventChoice).not.toHaveBeenCalled();
    expect(raw.shownChoice).toBe(false);
  });
});

describe("runFrame TOWER congratulations", () => {
  it("fires the TOWER congrats once and latches shownWin", () => {
    const sim = makeSim({ evaluatedTower: true });
    const { app, raw } = makeApp({ speed: 0, sim });
    runFrame(app, 16);
    expect(raw.shownWin).toBe(true);
    expect(raw.ui.congratsTower).toHaveBeenCalledTimes(1);
    expect(raw.audio.sfx).toHaveBeenCalledWith("promote");
  });

  it("suppresses the TOWER congrats behind the splash", () => {
    const sim = makeSim({ evaluatedTower: true });
    const { app, raw } = makeApp({ speed: 0, sim });
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    runFrame(app, 16);
    expect(raw.ui.congratsTower).not.toHaveBeenCalled();
    expect(raw.shownWin).toBe(false);
  });
});

describe("emitMealRushes", () => {
  beforeEach(() => {
    vi.mocked(decideMealRush).mockReset();
  });

  it("returns early when the steady clock is on (no bulletins, no decision)", () => {
    const { app, sim } = makeApp({ prefs: { steadyClock: true } });
    emitMealRushes(app, 0);
    expect(decideMealRush).not.toHaveBeenCalled();
    expect(sim.emit).not.toHaveBeenCalled();
  });

  it("returns early on non-finite clock minutes (tampered save)", () => {
    const sim = makeSim({ clock: { minuteOfDay: 0, minutes: NaN, calendar: { weekDays: 7, weekendDays: 2 } } });
    sim.tower.totalPopulation = vi.fn(() => 100);
    const { app } = makeApp({ prefs: { steadyClock: false }, sim });
    emitMealRushes(app, 0);
    expect(decideMealRush).not.toHaveBeenCalled();
  });

  it("returns early on non-finite frame-start minutes", () => {
    const sim = makeSim({ clock: { minuteOfDay: 0, minutes: 500, calendar: { weekDays: 7, weekendDays: 2 } } });
    sim.tower.totalPopulation = vi.fn(() => 100);
    const { app } = makeApp({ prefs: { steadyClock: false }, sim });
    emitMealRushes(app, Number.POSITIVE_INFINITY);
    expect(decideMealRush).not.toHaveBeenCalled();
  });

  it("stays quiet in a tiny tower (< 30 tenants)", () => {
    const sim = makeSim({ clock: { minuteOfDay: 0, minutes: 500, calendar: { weekDays: 7, weekendDays: 2 } } });
    sim.tower.totalPopulation = vi.fn(() => 29);
    const { app } = makeApp({ prefs: { steadyClock: false }, sim });
    emitMealRushes(app, 0);
    expect(decideMealRush).not.toHaveBeenCalled();
  });

  it("emits breakfast, lunch, and dinner when decideMealRush fires, latching each day", () => {
    const sim = makeSim({ clock: { minuteOfDay: 0, minutes: 2000, calendar: { weekDays: 7, weekendDays: 2 } } });
    sim.tower.totalPopulation = vi.fn(() => 40);
    vi.mocked(decideMealRush).mockReturnValue({ fire: true, dayOfKind: 5 });
    const { app, raw } = makeApp({ prefs: { steadyClock: false }, sim });

    emitMealRushes(app, 100);

    expect(decideMealRush).toHaveBeenCalledTimes(3);
    // Each meal passes its own hour + weekend rule (breakfast fires on weekends).
    const args = vi.mocked(decideMealRush).mock.calls.map((c) => c[0]);
    expect(args[0]).toMatchObject({ hour: 7, skipWeekend: false, before: 100, after: 2000 });
    expect(args[1]).toMatchObject({ hour: 12, skipWeekend: true });
    expect(args[2]).toMatchObject({ hour: 18, skipWeekend: true });
    expect(sim.emit).toHaveBeenCalledTimes(3);
    expect(raw.lastMealRushDay).toEqual({ breakfast: 5, lunch: 5, dinner: 5 });
  });

  it("emits nothing when decideMealRush declines every meal", () => {
    const sim = makeSim({ clock: { minuteOfDay: 0, minutes: 2000, calendar: { weekDays: 7, weekendDays: 2 } } });
    sim.tower.totalPopulation = vi.fn(() => 40);
    vi.mocked(decideMealRush).mockReturnValue({ fire: false, dayOfKind: 5 });
    const { app, raw } = makeApp({ prefs: { steadyClock: false }, sim });

    emitMealRushes(app, 100);

    expect(decideMealRush).toHaveBeenCalledTimes(3);
    expect(sim.emit).not.toHaveBeenCalled();
    expect(raw.lastMealRushDay).toEqual({ breakfast: -1, lunch: -1, dinner: -1 });
  });
});
