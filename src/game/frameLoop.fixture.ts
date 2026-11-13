import { vi } from "vitest";
import type { GameApp } from "../main";
import { PortCodes } from "../simport/portCodes";
import { mockPort } from "../tests/portKit/mockPort";

/** The fake engine port the frame loop tests drive: its commands land on the
 *  spies of a fake sim. */
interface SpiedSim {
  resolveChoice: unknown;
  emit: unknown;
  evaluatedTower?: boolean;
}

/** The codes, from the engine's published layout. */
export const portCodes = new PortCodes(mockPort());
const LOG_KINDS = ["info", "good", "bad", "money"];
/** The date slots a fake header carries (a real one reads them off the engine). */
const DATE_SLOTS = { day: 0, dayOfWeek: 0, isWeekend: false, quarter: 0, year: 0, weekDays: 7, weekendDays: 2 };

export function fakeEnginePort(sim: SpiedSim) {
  return {
    generation: vi.fn(() => 0),
    // How the engine cuts owed minutes into steps is its own
    // (`engine-rs/tests/fixed_step.rs`): this one steps nothing and hands back
    // the carry it was given, unless a test answers otherwise.
    advance: vi.fn((owed: number, _dtMs: number, _minutesPerSecond: number, _steadyClock: boolean, _step: boolean) => Float64Array.of(0, owed)),
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
      return { star: sim.star, pendingChoice: sim.pendingChoice, population, minutes: sim.clock.minutes, mode: "modern", modernCalendar: "realWorld", ...DATE_SLOTS };
    },
  };
}

/** The fake simulation behind a frame loop test's app: the clock, the
 *  emergency and the event drain the loop drives. */
export interface FakeSim {
  clock: { minuteOfDay: number; minutes: number; calendar: { weekDays: number; weekendDays: number } };
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
    audio: { update: vi.fn(), sfx: vi.fn(), setMusicDucked: vi.fn() },
    engine: { focus: vi.fn(() => ({})) },
    reader: fakeReader(sim),
    ui: {
      update: vi.fn(),
      isEditorOpen: vi.fn(() => false),
      isEditorBusy: vi.fn(() => false),
      showEventChoice: vi.fn(),
      congratsTower: vi.fn(),
      sayVisibly: vi.fn(),
      // The open dialog holds no work unless a test says so; it is asked
      // whether the shared dialog is open, as the real precedence is.
      precedence: { ownsPendingWork: vi.fn((_isOpen: boolean) => false) },
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
