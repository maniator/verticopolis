import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GameApp } from "../main";

/**
 * The seam's WIRING, which nothing else covers.
 *
 * `src/game/hostCommands.ts` is heavily unit-tested, but every call site that
 * actually drives it is written `if (IS_WRAPPED_BUILD) ...`, and that constant is
 * `false` under vitest by construction (the mode is `"test"`, not `"desktop"` or
 * `"native"`). So `runFrame` never called `tickHostCommands`, `runBootFlow` never
 * called `bindHostCommands`, and the crash path never ticked, in any test that has
 * ever run. All three lines could be deleted with the whole suite green, and the
 * build guard would not notice either: it greps the emitted bundle for string
 * literals, which survive as long as the module is imported at all.
 *
 * That gap is not academic. Three consecutive review rounds found defects in
 * exactly this wiring (a push stranded below an early return, an ordering change
 * that made the crash-path tick a no-op, a binding moved somewhere a throw could
 * skip), and none of them could have been caught by a test.
 *
 * This file closes it by mocking `../platform` so `IS_WRAPPED_BUILD` is true, then
 * asserting the call sites fire. It deliberately mocks `./hostCommands` too: what
 * is under test here is the WIRING, not the dispatch, and the dispatch already has
 * two suites of its own.
 */

vi.mock("../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform")>()),
  // The whole point: pretend this is a wrapped build.
  IS_WRAPPED_BUILD: true,
}));

vi.mock("./hostCommands", () => ({
  tickHostCommands: vi.fn(),
  bindHostCommands: vi.fn(),
  runHostCommand: vi.fn(),
  availableCommands: vi.fn(() => []),
  __resetHostCommandsForTest: vi.fn(),
}));

vi.mock("./trafficHud", () => ({ updateTraffic: vi.fn() }));
vi.mock("./panelAnchoring", () => ({ positionPanels: vi.fn() }));
vi.mock("./updateFlow", () => ({ maybeSurfaceUpdatePrompt: vi.fn() }));
vi.mock("./mealRush", () => ({ decideMealRush: vi.fn(() => null) }));

const { runFrame } = await import("./frameLoop");
const { tickHostCommands } = await import("./hostCommands");
const tick = vi.mocked(tickHostCommands);

/**
 * The same fake shape `frameLoop.test.ts` maintains, kept deliberately in step
 * with it: this file tests the same function's control flow, so a divergent fake
 * would mean the two suites disagree about what `runFrame` touches.
 */
function makeApp(over: Record<string, unknown> = {}) {
  const sim = {
    clock: { minuteOfDay: 0, minutes: 0, calendar: { weekDays: 7, weekendDays: 2 } },
    tick: vi.fn(),
    star: 1,
    pendingChoice: null,
    evaluatedTower: false,
    resolveChoice: vi.fn(),
    emit: vi.fn(),
    tower: { totalPopulation: vi.fn(() => 0) },
    events: { counts: { fires: 0, firesGutRooms: 0, bombs: 0 } },
  };
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

beforeEach(() => {
  tick.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runFrame drives the availability pump in a wrapped build", () => {
  it("ticks on the early return taken while a blocking choice is up", () => {
    // The state where EVERY command is refused, so it is the state the shell most
    // needs to hear about. A push stranded below this early return was a real
    // defect found in review: the menu stayed fully enabled exactly when nothing
    // could run.
    const { app } = makeApp({ shownChoice: true });
    runFrame(app, 16);
    expect(tick).toHaveBeenCalled();
  });

  it("ticks on the update-modal early return too", () => {
    const { app } = makeApp({ shownUpdate: true });
    runFrame(app, 16);
    expect(tick).toHaveBeenCalled();
  });

  it("ticks from the throttled UI pump during ordinary play", () => {
    // `lastUiUpdate` is far in the past, so the 160 ms gate is open.
    const { app } = makeApp();
    runFrame(app, 16);
    expect(tick).toHaveBeenCalled();
  });

  it("still ticks while the tower is PAUSED, because the pump gate is wall-clock", () => {
    // The property the old version of this test claimed to pin and did not: it
    // never called `runFrame` at all. `SPEEDS[0]` is 0, so the sim-advance loop
    // does no iterations, and the assertion is that the pump is reached anyway.
    // If the gate ever moved inside that loop, a paused game would freeze the
    // desktop menu's enabled state, and nobody would notice until a player paused
    // and wondered why New Game had gone gray.
    const { app, sim } = makeApp({ speed: 0 });
    runFrame(app, 16);
    expect(tick).toHaveBeenCalled();
    // And the sim genuinely did not advance, so the tick above is not riding on
    // the ordinary play path by accident.
    expect(sim.tick).not.toHaveBeenCalled();
  });
});
