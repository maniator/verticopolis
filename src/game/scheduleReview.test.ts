import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElevatorSchedule } from "../shared/engineTypes";
import { scheduleSlots } from "../simport/scheduleSlots";
import type { ViewReader } from "../simport/viewReader";
import { catalogFor } from "../tests/catalogFixture";
import { mockPort } from "../tests/portKit/mockPort";
import { keepAct, recoverAct, reviewAct } from "../ui/templates/scheduleReview";
import type { CardKit } from "./cardKit";
import { isDialogOpen, isSplashUp } from "./interactionState";
import { ScheduleReview } from "./scheduleReview";
import type { Acknowledgements, Decision } from "./scheduleRecovery";

vi.mock("./interactionState", () => ({ isDialogOpen: vi.fn(() => false), isSplashUp: vi.fn(() => false) }));

/**
 * The schedule review controller over a mock port and hand-built shafts: the
 * calls it makes and what it shows. The same flows on the Rust engine, with
 * real Undo and the saved schedule, are in
 * `src/tests/integration/scheduleReview.integration.test.ts`.
 */

const hours = (n: number): number[] => Array<number>(24).fill(n);
/** Shaft 7 runs 2 of its 4 cars every hour; shaft 9 runs 1 car on weekdays and all on weekends. */
const FLAT: ElevatorSchedule = { activeCars: { weekday: hours(2), weekend: hours(2) } };
const STAGGERED: ElevatorSchedule = { activeCars: { weekday: hours(1) } };
const shaft = (id: number, x: number) => ({ id, kind: "elevatorStandard" as const, x, bottom: 1, top: 9, cars: 4 });

function harness(answer = Float64Array.of(1, 0), reason?: string) {
  const engine = mockPort({ generation: () => 3, scheduleShaft: () => answer, lastReason: () => reason });
  const schedules = new Map<number, ElevatorSchedule>([
    [7, FLAT],
    [9, STAGGERED],
  ]);
  const reader = {
    update: vi.fn(),
    header: { sceneSeed: 42, mode: "classic" },
    tower: { transports: [shaft(7, 10), shaft(9, 20), { ...shaft(11, 30), kind: "stairs" }] },
  };
  const kit = {
    catalog: () => catalogFor("classic"),
    currentSchedule: vi.fn((id: number) => schedules.get(id)),
    cards: { shaft: vi.fn((id: number) => (schedules.has(id) ? {} : undefined)), forget: vi.fn() },
  };
  const decisions = new Map<string, Decision>();
  const acks: Acknowledgements = { get: (k) => decisions.get(k), set: (k, d) => void decisions.set(k, d) };
  const deps = {
    engine: () => engine,
    reader: () => reader as unknown as ViewReader,
    kit: () => kit as unknown as CardKit,
    ui: { toast: vi.fn(), sayVisibly: vi.fn(), showScheduleReview: vi.fn() },
    audio: { sfx: vi.fn() },
    captureUndo: vi.fn(),
    commitUndo: vi.fn(),
    refreshEditor: vi.fn(),
    announce: vi.fn(),
    openSchedule: vi.fn(),
    acknowledgements: acks,
  };
  const lastDialog = () =>
    deps.ui.showScheduleReview.mock.lastCall as [{ id: number; kept: boolean }[], Record<string, () => void>, string?];
  return { engine, reader, kit, deps, decisions, schedules, review: new ScheduleReview(deps), lastDialog };
}

beforeEach(() => {
  vi.mocked(isSplashUp).mockReturnValue(false);
  vi.mocked(isDialogOpen).mockReturnValue(false);
});

describe("ScheduleReview", () => {
  it("finds the elevators a schedule leaves short, reading each elevator's schedule once", () => {
    const { review, kit } = harness();
    const found = review.findings();
    expect(found.map((f) => [f.shaft.id, f.flatAt])).toEqual([
      [7, 2],
      [9, null],
    ]);
    expect(kit.currentSchedule.mock.calls).toEqual([[7], [9]]);
  });

  it("mentions a flat short schedule once per loaded tower, and waits while the title or a dialog is up", () => {
    const { review, deps, engine, decisions } = harness();
    vi.mocked(isSplashUp).mockReturnValue(true);
    review.tick();
    vi.mocked(isSplashUp).mockReturnValue(false);
    vi.mocked(isDialogOpen).mockReturnValue(true);
    review.tick();
    expect(engine.generation, "nothing is read behind the title or a dialog").not.toHaveBeenCalled();
    vi.mocked(isDialogOpen).mockReturnValue(false);
    review.tick();
    review.tick();
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "An elevator has more cars than its schedule puts on shift. Open Full Statistics to review it. Nothing changes unless you choose it.",
      "info",
    );
    expect([...decisions]).toEqual([["classic:42:7:elevatorStandard:10", "told"]]);
  });

  it("opens the dialog with a row per short elevator and the actions each one offers", () => {
    const { review, deps, reader, lastDialog } = harness();
    review.open();
    expect(reader.update).toHaveBeenCalledOnce();
    const [rows, handlers, focus] = lastDialog();
    expect(rows.map((r) => r.id)).toEqual([7, 9]);
    expect(rows[0]).toMatchObject({
      title: "Standard Elevator, floors 1–9",
      facts: "4 cars installed. 2 are on shift in every hour, weekdays and weekends.",
      kept: false,
    });
    expect(rows[1]).toMatchObject({
      facts: "4 cars installed. Between 1 and 4 are on shift, depending on the hour and the day.",
      preview: undefined,
    });
    expect(Object.keys(handlers).sort()).toEqual([keepAct(7), recoverAct(7), reviewAct(7), reviewAct(9)].sort());
    expect(focus).toBeUndefined();
    handlers[reviewAct(9)]!();
    expect(deps.openSchedule).toHaveBeenCalledExactlyOnceWith(9);
  });

  it("puts the whole fleet on every on-shift hour as one undo step", () => {
    const { review, deps, engine, kit, lastDialog } = harness();
    review.recover(7);
    const all: ElevatorSchedule = { activeCars: { weekday: hours(4), weekend: hours(4) } };
    expect(engine.scheduleShaft).toHaveBeenCalledExactlyOnceWith(7, scheduleSlots(all));
    expect(deps.captureUndo).toHaveBeenCalledExactlyOnceWith("Use all elevator cars");
    expect(deps.commitUndo).toHaveBeenCalledOnce();
    expect(deps.captureUndo.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(engine.scheduleShaft).mock.invocationCallOrder[0]!);
    expect(vi.mocked(engine.scheduleShaft).mock.invocationCallOrder[0]).toBeLessThan(deps.commitUndo.mock.invocationCallOrder[0]!);
    expect(kit.cards.forget).toHaveBeenCalledOnce();
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
    expect(deps.announce).toHaveBeenCalledExactlyOnceWith("Elevator floors 1 to 9 now uses all 4 cars.");
    expect(deps.refreshEditor).toHaveBeenCalledOnce();
    expect(lastDialog()[2], "focus moves to the next elevator").toBe(reviewAct(9));
  });

  it("keeps focus on a refused recovery and says the engine's reason after redrawing", () => {
    const { review, deps, lastDialog } = harness(Float64Array.of(0, 0), "Not enough money.");
    review.recover(7);
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
    expect(deps.refreshEditor).not.toHaveBeenCalled();
    expect(lastDialog()[2]).toBe(recoverAct(7));
    expect(deps.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith("Not enough money.", "bad");
    expect(deps.ui.showScheduleReview.mock.invocationCallOrder[0]).toBeLessThan(deps.ui.sayVisibly.mock.invocationCallOrder[0]!);
  });

  it("sends nothing to the engine for an elevator that no longer needs it", () => {
    const { review, deps, engine } = harness();
    review.recover(9);
    expect(engine.scheduleShaft).not.toHaveBeenCalled();
    expect(deps.captureUndo).not.toHaveBeenCalled();
    expect(deps.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith("That elevator already uses all of its cars.", "info");
  });

  it("remembers a kept schedule and stops offering to keep it", () => {
    const { review, deps, decisions, lastDialog } = harness();
    review.keep(7);
    expect(decisions.get("classic:42:7:elevatorStandard:10")).toBe("kept");
    expect(deps.announce).toHaveBeenCalledExactlyOnceWith("Kept the schedule of the elevator on floors 1 to 9 as it is.");
    const [rows, handlers, focus] = lastDialog();
    expect(rows[0]!.kept).toBe(true);
    expect(handlers[keepAct(7)]).toBeUndefined();
    expect(focus).toBe(recoverAct(7));
  });

  it("says an elevator is gone when an Undo took it away since the list was drawn", () => {
    const { review, deps, schedules, lastDialog } = harness();
    review.open();
    const reviewNine = lastDialog()[1][reviewAct(9)]!;
    schedules.delete(9);
    reviewNine();
    expect(deps.openSchedule).not.toHaveBeenCalled();
    expect(deps.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith("That elevator is gone.", "info");
  });
});
