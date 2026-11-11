import { vi } from "vitest";
import type { AutoTuneDay, AutoTuneProposal, PresetProposal, ScheduleFacts } from "../simport/enginePort";
import { SCHEDULE_HOURS } from "../simport/scheduleSlots";
import { makeUI, mountAppDom } from "../tests/uiFixture";
import type { FloorRow } from "./templates/elevatorSchedule";
import { scheduleDialogUX } from "./scheduleDialogRules";
import type { ScheduleDialogCtx } from "./uiElevatorSchedule";

/**
 * Canned engine answers and a DOM harness for the schedule dialog's unit
 * tests. The dialog's `autoTune`, `facts` and `preset` are `vi.fn` spies that
 * return the fixed answers below (a test swaps in its own with
 * `mockReturnValue`), so a test asserts the calls the dialog makes and what it
 * does with each answer. The answers themselves are the engine's business,
 * pinned in Rust (`schedule_authoring_tests`, `schedule_facts_tests`,
 * `schedule_presets_tests`).
 */

export const MODERN_UX = scheduleDialogUX({ scheduleAssist: true });
export const CLASSIC_UX = scheduleDialogUX({ scheduleAssist: false });

/** The test shaft: four cars over floors 1 to 4, the lobby at 1. */
export const CARS = 4;
export const TOP = 4;

export const row = (n: number): number[] => Array<number>(SCHEDULE_HOURS).fill(n);

export const COLD_DAY: AutoTuneDay = { warm: false, sampledHours: 0, curve: null };
/** A warm day whose measured curve peaks at 08:00. */
export const WARM_DAY: AutoTuneDay = { warm: true, sampledHours: SCHEDULE_HOURS, curve: row(0.2).map((v, h) => (h === 8 ? 1 : v)) };

/** No day warm yet: Auto-tune is not offered. */
export const TUNE_COLD: AutoTuneProposal = { status: "insufficient-data", weekday: COLD_DAY, weekend: COLD_DAY, proposal: null };
/** A warm weekday: Auto-tune proposes a weekday row and split homes. */
export const TUNE_WEEKDAY: AutoTuneProposal = {
  status: "available",
  weekday: WARM_DAY,
  weekend: COLD_DAY,
  proposal: { weekday: row(2).map((v, h) => (h === 8 ? CARS : v)), weekend: null, homeFloors: [1, 1, 4, 4], homesSeeded: true },
};

/** Ready advice with nothing off, a measured 08:00 peak, and no homes of its
 *  own (an empty list), so the dialog keeps its working homes. */
export const FACTS: ScheduleFacts = {
  status: "available",
  recommended: "rush",
  advice: { status: "ready", over: [], short: [] },
  staging: { measured: true, peakHour: 8, activeAtPeak: CARS, upTowerCars: 1, lobbyCars: 3, topLobby: TOP, baseLobby: 1 },
  homeFloors: [],
};

export const PRESET: PresetProposal = { status: "available", weekday: row(2), weekend: row(3), homeFloors: [4, 4, 4, 4] };

/** Live stop rows for floors `bottom` to `top`, descending, with spies for the
 *  edits. `refuse` lists floors whose toggle the port ignores. */
export function stopsPort(top = TOP, lobbies: readonly number[] = [1], refuse: readonly number[] = [], bottom = 1) {
  const span = top - bottom + 1;
  const every = (): Set<number> => new Set(Array.from({ length: span }, (_, i) => bottom + i));
  let served = every();
  const read = vi.fn((): FloorRow[] =>
    Array.from({ length: span }, (_, i) => top - i).map((floor) => ({
      floor,
      served: served.has(floor),
      lobby: lobbies.includes(floor),
      endpoint: floor === bottom || floor === top,
    })),
  );
  return {
    read,
    setServe: vi.fn(async (floor: number, serve: boolean) => {
      if (refuse.includes(floor)) return;
      if (serve) served.add(floor);
      else served.delete(floor);
    }),
    expressStops: vi.fn(async () => {
      served = new Set([bottom, top, ...lobbies]);
    }),
    allStops: vi.fn(async () => {
      served = every();
    }),
  };
}

export type Spied = ScheduleDialogCtx & {
  autoTune: ReturnType<typeof vi.fn<ScheduleDialogCtx["autoTune"]>>;
  facts: ReturnType<typeof vi.fn<ScheduleDialogCtx["facts"]>>;
  preset: ReturnType<typeof vi.fn<ScheduleDialogCtx["preset"]>>;
  stops: ReturnType<typeof stopsPort>;
  announce: ReturnType<typeof vi.fn<(msg: string) => void>>;
};

/** The canned answers a case hands the spies, in place of the defaults. */
export interface Answers {
  autoTune?: AutoTuneProposal;
  facts?: ScheduleFacts;
  preset?: PresetProposal;
}

/** Open the dialog on a Modern four-car shaft, any field overridden and any
 *  canned answer replaced. Each engine query is a `vi.fn` returning its answer. */
export function open(over: Partial<Omit<ScheduleDialogCtx, keyof Answers>> & Answers = {}) {
  mountAppDom();
  const { ui } = makeUI();
  const { autoTune = TUNE_COLD, facts = FACTS, preset = PRESET, ...rest } = over;
  const ctx = {
    title: "Schedule: Standard elevator (floors 1-4)",
    ux: MODERN_UX,
    isExpress: false,
    cars: CARS,
    bottom: 1,
    top: TOP,
    stops: stopsPort(),
    autoTune: vi.fn<ScheduleDialogCtx["autoTune"]>(() => autoTune),
    facts: vi.fn<ScheduleDialogCtx["facts"]>(() => facts),
    preset: vi.fn<ScheduleDialogCtx["preset"]>(() => preset),
    initialWeekend: false,
    announce: vi.fn<(msg: string) => void>(),
    ...rest,
  } as Spied;
  const apply = vi.fn(async (_s: unknown) => {});
  ui.showElevatorScheduleDialog(ctx, { apply });
  return { ui, ctx, apply };
}

export const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;
export const q = <T extends Element = HTMLElement>(sel: string): T | null => dialog().querySelector<T>(sel as never) as T | null;
export const press = (sel: string): void => q<HTMLButtonElement>(sel)!.click();
export const text = (sel: string): string | undefined => q(sel)?.textContent ?? undefined;
export const button = (label: string): HTMLButtonElement =>
  Array.from(dialog().querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label)!;
export const chipAt = (floor: number, car: number): HTMLButtonElement =>
  q<HTMLButtonElement>(`button[aria-label="Home car ${car} at floor ${floor}"]`)!;
export const ok = (): void => press('[data-act="apply"]');
export const cancel = (): void => press('[data-act="close"]');
/** The schedule the last OK handed to `apply`. */
export const saved = (apply: { mock: { calls: unknown[][] } }) =>
  apply.mock.calls[apply.mock.calls.length - 1][0] as {
    activeCars: { weekday: number[]; weekend: number[] };
    homeFloors: number[];
    waitingCarResponse: number;
    standardFloorDeparture: number;
  };

/** The last string the dialog announced. */
export const lastAnnounce = (ctx: Spied): string | undefined => ctx.announce.mock.lastCall?.[0];
/** Let a settled stop edit's continuation run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
/** The chips marked as a car's home, as `floor:car` pairs. */
export const homesShown = (): string[] =>
  Array.from(dialog().querySelectorAll<HTMLButtonElement>(".es-chip.on")).map((b) => b.getAttribute("aria-label")!.replace(/^Home car (\d+) at floor (\S+)$/, "$2:$1"));
