import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SPEEDS, runFrame, emitMealRushes, applySpeed } from "./frameLoop";
import { MAX_STEP_MS } from "../render/excalibur/crowdLook";
import { decideMealRush } from "./mealRush";
import { gameplaySession } from "../analytics";
import * as analyticsActions from "../analyticsActions";
import { makeApp, makeSim } from "./frameLoop.fixture";

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
 * The engine port is a fake whose `advance` hands back the carry it was given
 * unless a test says otherwise: how the engine cuts owed minutes into steps
 * (the pace curve, the quantum, the catch-up cap, a bad amount, a mode
 * change) is the Rust engine's, checked in `engine-rs/tests/fixed_step.rs`.
 */

vi.mock("./trafficHud", () => ({ updateTraffic: vi.fn() }));
vi.mock("./panelAnchoring", () => ({ positionPanels: vi.fn() }));
vi.mock("./updateFlow", () => ({ maybeSurfaceUpdatePrompt: vi.fn() }));
vi.mock("./mealRush", () => ({ decideMealRush: vi.fn(() => ({ fire: false, dayOfKind: 0 })) }));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SPEEDS", () => {
  it("maps the four speed indices to in-game minutes per real second", () => {
    expect(SPEEDS).toEqual([0, 3, 15, 50]);
  });
});

describe("the slowest speed against the render glide", () => {
  it("keeps the slowest button's longest step inside the glide, even in the lunch slowdown", () => {
    // The canon clock's slowest period runs at 30 game minutes over 400 of the
    // day's 2,600 frames (12:00 to 13:00), 0.135 of an even day
    // (engine-rs/src/tdt/pacing.rs). A one-minute step then lasts this long.
    const lunchPace = 30 / 400 / (1440 / 2600);
    const slowestStepMs = 1000 / (SPEEDS[1] * lunchPace);
    expect(slowestStepMs).toBeGreaterThan(1000);
    expect(slowestStepMs).toBeLessThanOrEqual(MAX_STEP_MS);
  });
});

describe("runFrame freeze path", () => {
  it("freezes time (accMinutes -> 0, no step) while an emergency choice modal is up", () => {
    const { app, raw } = makeApp({ shownChoice: true, accMinutes: 12 });
    runFrame(app, 1000);
    expect(raw.accMinutes).toBe(0);
    expect(raw.enginePort.advance).not.toHaveBeenCalled();
  });

  it("freezes time while the update prompt is up", () => {
    const { app, raw } = makeApp({ shownUpdate: true, accMinutes: 9 });
    runFrame(app, 1000);
    expect(raw.accMinutes).toBe(0);
    expect(raw.enginePort.advance).not.toHaveBeenCalled();
  });

  it("still reads the view under a modal, so people stand where the camera pans", () => {
    const { app, raw } = makeApp({ shownChoice: true, accMinutes: 12 });
    runFrame(app, 1000);
    expect(raw.enginePort.advance).not.toHaveBeenCalled();
    expect(raw.enginePort.setPeopleWindow).toHaveBeenCalledExactlyOnceWith(9, 41, -2, 102);
    expect(raw.reader.update).toHaveBeenCalledTimes(1);
  });

  it("stops time for good once a wasm-only build has stopped on its engine, whatever the speed", () => {
    const { app, raw } = makeApp({ accMinutes: 7 });
    const stop = document.createElement("div");
    stop.id = "engine-failure";
    document.body.appendChild(stop);
    try {
      runFrame(app, 1000);
      expect(raw.accMinutes).toBe(0);
      expect(raw.enginePort.advance).not.toHaveBeenCalled();
    } finally {
      stop.remove();
    }
  });

  it("still samples the frame for session_fps before the freeze returns early", () => {
    // noteFrame is a render metric, so it must run on every frame INCLUDING the
    // ones a modal freeze bails out on. This guards the call-ordering: a refactor
    // moving the noteFrame call below the freeze return would silently drop fps
    // sampling whenever a modal is open.
    const spy = vi.spyOn(gameplaySession, "noteFrame").mockImplementation(() => {});
    const { app, raw } = makeApp({ shownChoice: true, accMinutes: 12 });
    runFrame(app, 1000);
    expect(spy).toHaveBeenCalledTimes(1); // sampled despite the frozen frame
    expect(raw.enginePort.advance).not.toHaveBeenCalled(); // and the freeze still held
    spy.mockRestore();
  });
});

describe("runFrame simulation stepping", () => {
  it("hands the engine the carry, the frame, the speed's pace and the steady clock, and keeps the carry it answers", () => {
    const { app, raw } = makeApp({ speed: 1, accMinutes: 0.5, prefs: { steadyClock: false } });
    raw.enginePort.advance.mockReturnValueOnce(Float64Array.of(2, 0.75));
    runFrame(app, 250);
    expect(raw.enginePort.advance).toHaveBeenCalledExactlyOnceWith(0.5, 250, SPEEDS[1], false, true);
    expect(raw.accMinutes).toBe(0.75);
  });

  it("passes the steady clock when the player turned it on, and the fastest speed's pace", () => {
    const { app, raw } = makeApp({ speed: 3, accMinutes: 0 });
    runFrame(app, 1000 / 60);
    expect(raw.enginePort.advance).toHaveBeenCalledExactlyOnceWith(0, 1000 / 60, SPEEDS[3], true, true);
  });

  it("hands a paused game's carry over at no pace, and the engine's answer stands", () => {
    const { app, raw } = makeApp({ speed: 0, accMinutes: 5.5 });
    raw.enginePort.advance.mockReturnValueOnce(Float64Array.of(0, 0));
    runFrame(app, 1000 / 60);
    expect(raw.enginePort.advance).toHaveBeenCalledExactlyOnceWith(5.5, 1000 / 60, 0, true, true);
    expect(raw.accMinutes).toBe(0);
  });

  it("drops the carry when a step throws mid-frame, so steps that ran are never owed again", () => {
    const { app, raw } = makeApp({ speed: 3, accMinutes: 4 });
    raw.enginePort.advance.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => runFrame(app, 100)).toThrow("boom");
    expect(raw.accMinutes).toBe(0);
    expect(raw.reader.update, "no view is read after a failed step").not.toHaveBeenCalled();
  });

  it("drops minutes carried at one speed when the speed changes", () => {
    const { app, raw } = makeApp({ speed: 3, accMinutes: 16 });
    applySpeed(app, 1);
    expect(raw.accMinutes).toBe(0);
    runFrame(app, 100);
    expect(raw.enginePort.advance).toHaveBeenCalledExactlyOnceWith(0, 100, SPEEDS[1], true, true);
  });

  it("drops the carry on a speed change undone before the next frame (fastest, pause, fastest)", () => {
    const { app, raw } = makeApp({ speed: 3, accMinutes: 16 });
    applySpeed(app, 0);
    applySpeed(app, 3);
    expect(raw.accMinutes).toBe(0);
    runFrame(app, 0);
    expect(raw.enginePort.advance, "the seam already dropped the carry").toHaveBeenCalledExactlyOnceWith(0, 0, SPEEDS[3], true, true);
  });

  it("keeps the carry when the speed is set to the one already running", () => {
    const { app, raw } = makeApp({ speed: 3, accMinutes: 16 });
    applySpeed(app, 3);
    expect(raw.accMinutes).toBe(16);
    expect(raw.speed).toBe(3);
  });

  it("hands the engine a steady clock the player toggled, which drops the old mode's carry", () => {
    const { app, raw } = makeApp({ speed: 3, accMinutes: 16 });
    raw.prefs.steadyClock = false;
    raw.enginePort.advance.mockReturnValueOnce(Float64Array.of(0, 0));
    runFrame(app, 0);
    expect(raw.enginePort.advance).toHaveBeenCalledExactlyOnceWith(16, 0, SPEEDS[3], false, true);
    expect(raw.accMinutes).toBe(0);
  });

  it("steps through the port and reads the view once per frame, after the step", () => {
    const { app, raw } = makeApp({ speed: 3, accMinutes: 0, lastUiUpdate: Infinity });
    runFrame(app, 1000 / 60);
    runFrame(app, 1000 / 60);
    expect(raw.enginePort.advance).toHaveBeenCalledTimes(2);
    expect(raw.reader.update).toHaveBeenCalledTimes(2);
    expect(raw.reader.update.mock.invocationCallOrder[0]).toBeGreaterThan(raw.enginePort.advance.mock.invocationCallOrder[0]);
  });

  it("sends the camera's people window before it reads the view", () => {
    const { app, raw } = makeApp({ speed: 3, accMinutes: 0, lastUiUpdate: Infinity });
    runFrame(app, 1000 / 60);
    // The fixture's camera shows tiles 0 to 100 and floors 10 to 40; the
    // window adds two tiles and one floor on each side.
    expect(raw.enginePort.setPeopleWindow).toHaveBeenCalledExactlyOnceWith(9, 41, -2, 102);
    expect(raw.enginePort.setPeopleWindow.mock.invocationCallOrder[0]).toBeLessThan(raw.reader.update.mock.invocationCallOrder[0]);
  });

  it("judges no meal rush across a swap since the last frame", () => {
    const { app, raw } = makeApp({ speed: 3, prefs: { steadyClock: false } });
    runFrame(app, 1000 / 60);
    expect(decideMealRush).toHaveBeenCalled();
    vi.mocked(decideMealRush).mockClear();
    raw.reader.generation = -1; // the view was read in the tower before a load
    runFrame(app, 1000 / 60);
    expect(decideMealRush).not.toHaveBeenCalled();
  });

  it("hands the engine a non-finite frame as it came, and keeps the carry it answers (#541)", () => {
    // The engine owes nothing for a bad amount (a_bad_amount_or_rate_steps_nothing_and_owes_nothing),
    // so one NaN or Infinity frame cannot freeze the sim.
    for (const dt of [NaN, Number.POSITIVE_INFINITY]) {
      const { app, raw } = makeApp({ speed: 3, accMinutes: 0 });
      raw.enginePort.advance.mockReturnValueOnce(Float64Array.of(0, 0));
      runFrame(app, dt);
      expect(raw.enginePort.advance).toHaveBeenCalledExactlyOnceWith(0, dt, SPEEDS[3], true, true);
      expect(raw.accMinutes).toBe(0);
    }
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
    // Answered through the port at once: the latch clears, then the header is read again.
    (cb as (opt: unknown) => void)("accept");
    expect(sim.resolveChoice).toHaveBeenCalledWith("accept");
    expect(Math.max(...vi.mocked(app.reader.update).mock.invocationCallOrder)).toBeGreaterThan(vi.mocked(sim.resolveChoice).mock.invocationCallOrder[0]);
    expect(raw.shownChoice).toBe(false);
  });

  it("reports emergency_choice from the engine's event on the next frame, even while a modal freezes play", () => {
    const spy = vi.spyOn(analyticsActions, "trackEmergencyChoice").mockImplementation(() => {});
    const pc = { kind: "fireRescue" as const, message: "Fire on floor 30!", cost: 5000 };
    const queue: unknown[] = [];
    const sim = makeSim({ pendingChoice: pc, drainGameplayEvents: vi.fn(() => queue.splice(0)) });
    // The engine reports the resolution itself (emergency_resolved, source player).
    sim.resolveChoice.mockImplementation((opt: string) => {
      queue.push({ name: "emergency_resolved", payload: { kind: "fireRescue", decision: opt, source: "player" } });
    });
    const { app, raw } = makeApp({ speed: 0, sim });
    runFrame(app, 16);
    // Opening the modal alone must not log: a choice not yet made emits nothing.
    expect(spy).not.toHaveBeenCalled();
    const cb = raw.ui.showEventChoice.mock.calls[0][2] as (opt: unknown) => void;
    cb("decline");
    expect(sim.resolveChoice).toHaveBeenCalledWith("decline");
    raw.shownChoice = true; // a modal still up: the frame returns at the freeze
    runFrame(app, 16);
    expect(spy).toHaveBeenCalledExactlyOnceWith("fireRescue", "decline");
    spy.mockRestore();
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
    vi.mocked(decideMealRush).mockReset().mockReturnValue({ fire: false, dayOfKind: 0 });
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
    vi.mocked(decideMealRush).mockReturnValue({ fire: true, dayOfKind: 5 });
    const { app, raw } = makeApp({ prefs: { steadyClock: false }, sim });
    raw.reader.update(); // the frame's census
    emitMealRushes(app, 0);
    // Every rush was due: nothing fired or latched.
    expect([sim.tower.totalPopulation.mock.calls.length, vi.mocked(sim.emit).mock.calls.length, raw.lastMealRushDay.breakfast]).toEqual([1, 0, -1]);
  });

  it("emits breakfast, lunch, and dinner when decideMealRush fires, latching each day", () => {
    const sim = makeSim({ clock: { minuteOfDay: 0, minutes: 2000, calendar: { weekDays: 7, weekendDays: 2 } } });
    sim.tower.totalPopulation = vi.fn(() => 40);
    vi.mocked(decideMealRush).mockReturnValue({ fire: true, dayOfKind: 5 });
    const { app, raw } = makeApp({ prefs: { steadyClock: false }, sim });
    raw.reader.update(); // the frame's census
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
