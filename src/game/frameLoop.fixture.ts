import { vi } from "vitest";
import type { GameApp } from "../main";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { advanceOwedMinutes } from "../engine/sim/frameStep";
import { PortCodes } from "../simport/portCodes";

/** The fake engine port the frame loop tests drive: its commands land on the
 *  spies of a fake sim. */
interface SpiedSim {
  tick: unknown;
  clock: { minuteOfDay: number };
  resolveChoice: unknown;
  emit: unknown;
  evaluatedTower?: boolean;
}

export const portCodes = new PortCodes(new TsEngine(Simulation.newGame(1)));
const LOG_KINDS = ["info", "good", "bad", "money"];

export function fakeEnginePort(sim: SpiedSim) {
  // The step mode outlives a frame, as the engine's does.
  const debt = { minutes: 0 };
  return {
    generation: vi.fn(() => 0),
    advance: vi.fn((owed: number, dtMs: number, minutesPerSecond: number, steadyClock: boolean, step: boolean) => {
      const host = { sim: sim as { tick(dt: number): void; clock: { minuteOfDay: number } }, accMinutes: owed };
      advanceOwedMinutes(host, debt, dtMs, minutesPerSecond, steadyClock, step);
      return Float64Array.of(0, host.accMinutes);
    }),
    hotspot: vi.fn(() => Float64Array.of(0, NaN)),
    evaluatedTower: vi.fn(() => sim.evaluatedTower === true),
    answerChoice: vi.fn((accept: boolean) => {
      (sim.resolveChoice as (opt: string) => void)(accept ? "accept" : "decline");
      return Float64Array.of(1, 0);
    }),
    logLine: vi.fn((text: string, kindCode: number) => {
      (sim.emit as (t: string, k: string) => void)(text, LOG_KINDS[kindCode]);
      return Float64Array.of(1, 0);
    }),
  };
}

/** The shared reader over the fake sim: the header reads the sim's star and
 *  emergency as they stand, and its population is the census taken at the
 *  last update, as the real reader's is. */
export function fakeReader(sim: { star: number; pendingChoice: unknown; clock: { minutes: number }; tower: { totalPopulation: unknown } }) {
  let population = 0;
  return {
    generation: 0,
    update: vi.fn(() => {
      population = (sim.tower.totalPopulation as () => number)();
    }),
    rooms: [],
    structure: [],
    get header() {
      return { star: sim.star, pendingChoice: sim.pendingChoice, population, minutes: sim.clock.minutes, mode: "modern", modernCalendar: "realWorld" };
    },
  };
}

/** The fake simulation behind a frame loop test's app: the tick, the clock,
 *  the emergency and the event drain the loop drives. */
export interface FakeSim {
  clock: { minuteOfDay: number; minutes: number; calendar: { weekDays: number; weekendDays: number } };
  tick: ReturnType<typeof vi.fn>;
  star: number;
  pendingChoice: { kind?: "fireRescue" | "bombThreat"; message: string; cost: number } | null;
  evaluatedTower: boolean;
  resolveChoice: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  tower: { totalPopulation: ReturnType<typeof vi.fn> };
  drainGameplayEvents: ReturnType<typeof vi.fn>;
  gameplayEventsDropped: number;
  gameplayEvents: { discardOnHandOff: boolean };
}

export function makeSim(over: Partial<FakeSim> = {}): FakeSim {
  return {
    clock: { minuteOfDay: 0, minutes: 0, calendar: { weekDays: 7, weekendDays: 2 } },
    tick: vi.fn(),
    star: 1,
    pendingChoice: null,
    evaluatedTower: false,
    resolveChoice: vi.fn(),
    emit: vi.fn(),
    tower: { totalPopulation: vi.fn(() => 0) },
    drainGameplayEvents: vi.fn(() => []),
    gameplayEventsDropped: 0,
    gameplayEvents: { discardOnHandOff: false },
    ...over,
  };
}

export function makeApp(over: Record<string, unknown> = {}) {
  const sim = (over.sim as FakeSim) ?? makeSim();
  const app = {
    shownChoice: false,
    shownUpdate: false,
    speed: 3,
    prefs: { steadyClock: true },
    sim, events: sim, // the fake sim drains as the port's events do
    enginePort: fakeEnginePort(sim), // commands land on the fake's spies
    portCodes,
    accMinutes: 0,
    audio: { update: vi.fn(), sfx: vi.fn() },
    engine: { focus: vi.fn(() => ({})) },
    reader: fakeReader(sim),
    ui: {
      update: vi.fn(),
      isEditorOpen: vi.fn(() => false),
      isEditorBusy: vi.fn(() => false),
      showEventChoice: vi.fn(),
      congratsTower: vi.fn(),
    },
    onboarding: { tick: vi.fn() },
    scheduleReview: { tick: vi.fn() },
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
