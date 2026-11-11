import { describe, expect, it, vi } from "vitest";
import { scheduleSlots } from "../simport/scheduleSlots";
import {
  lift,
  rec,
  SCHEDULE,
  setup,
  type Answers,
} from "./editorActions.fixture";

vi.mock("../simport/headerClock", () => ({
  clockOf: () => ({ hour: 9, isWeekend: true }),
}));

/** The editor's schedule dialog and extend-arrow drag over a mock port: the
 *  stop, schedule and extend commands they send, the undo steps around them,
 *  and what they show for the engine's answers. */

describe("EditorActions: schedule dialog", () => {
  type Ctx = {
    title: string;
    isExpress: boolean;
    cars: number;
    current: unknown;
    origins: unknown;
    initialWeekend: boolean;
    stops: {
      read(): number[];
      setServe(f: number, s: boolean): Promise<void>;
      expressStops(): Promise<void>;
      allStops(): Promise<void>;
    };
    autoTune(d: unknown, w: boolean): unknown;
    facts(d: unknown, w: boolean): unknown;
    preset(name: string): unknown;
    announce(msg: string): void;
  };
  type Cb = { apply(schedule: unknown): Promise<void> };

  function opened(answers: Answers = {}) {
    const s = setup(
      {
        markStop: () => rec("buildAt", true),
        expressStops: () => rec("buildAt", true),
        dropStops: () => rec("buildAt", true),
        autoTuneProposal: () => "tuned" as never,
        scheduleFacts: () => "facts" as never,
        schedulePreset: () => "preset" as never,
        scheduleShaft: () => rec("buildAt", true),
        ...answers,
      },
      null,
    );
    s.actions.openSchedule(lift.id);
    const [ctx, cb] = s.deps.ui.showElevatorScheduleDialog.mock
      .calls[0] as unknown as [Ctx, Cb];
    return { ...s, ctx, cb };
  }

  it("opens for a named shaft with its live facts and the engine's schedule", () => {
    const { ctx, reader, kit } = opened();
    expect(reader.update).toHaveBeenCalledOnce();
    expect(ctx.title).toBe(
      `Schedule: Standard Elevator (floors ${lift.bottom}-${lift.top})`,
    );
    expect(ctx).toMatchObject({
      isExpress: false,
      cars: lift.cars,
      current: SCHEDULE,
      initialWeekend: true,
    });
    expect(kit.currentSchedule).toHaveBeenCalledExactlyOnceWith(lift.id);
    expect(ctx.stops.read()).toEqual(lift.stops);
    expect(ctx.origins, "each hour's origin counts become a map").toEqual({
      weekday: [new Map([[3, 2]])],
      weekend: [new Map()],
    });
  });

  it("does not open for no shaft, a unit, or a stairway", () => {
    const none = setup({}, null);
    none.actions.openSchedule();
    const unit = setup();
    unit.actions.openSchedule();
    const stairs = setup({}, { type: "transport", id: lift.id });
    stairs.cards.shaft.mockReturnValue({ ...lift, kind: "stairs" });
    stairs.actions.openSchedule();
    for (const s of [none, unit, stairs])
      expect(s.deps.ui.showElevatorScheduleDialog).not.toHaveBeenCalled();
  });

  it("each stop edit is its own undo step against the live shaft", async () => {
    const { ctx, port, deps, cards } = opened();
    await ctx.stops.setServe(3, false);
    expect(port.markStop).toHaveBeenCalledExactlyOnceWith(lift.id, 3, false);
    await ctx.stops.expressStops();
    expect(port.expressStops).toHaveBeenCalledExactlyOnceWith(lift.id);
    await ctx.stops.allStops();
    expect(port.dropStops).toHaveBeenCalledExactlyOnceWith(lift.id);
    expect(deps.captureUndo.mock.calls).toEqual([
      ["Elevator stops"],
      ["Elevator stops"],
      ["Elevator stops"],
    ]);
    expect(deps.commitUndo).toHaveBeenCalledTimes(3);
    expect(cards.forget).toHaveBeenCalledTimes(3);
    expect(
      deps.audio.sfx.mock.calls,
      "the serve toggle is silent, the bulk actions click",
    ).toEqual([["click"], ["click"]]);
  });

  it("a stop edit on a shaft that is gone sends nothing", async () => {
    const { ctx, port, cards } = opened();
    cards.shaft.mockReturnValue(undefined);
    await ctx.stops.setServe(3, false);
    expect(port.markStop).not.toHaveBeenCalled();
    expect(ctx.stops.read()).toEqual([]);
  });

  it("asks the engine for the tuning, the facts and a preset, live", () => {
    const { ctx, port } = opened();
    const draft = { cars: [] };
    expect(ctx.autoTune(draft, true)).toBe("tuned");
    expect(port.autoTuneProposal).toHaveBeenCalledExactlyOnceWith(
      lift.id,
      scheduleSlots(draft as never),
      true,
    );
    expect(ctx.facts(draft, false)).toBe("facts");
    expect(port.scheduleFacts).toHaveBeenCalledExactlyOnceWith(
      lift.id,
      scheduleSlots(draft as never),
      false,
    );
    expect(ctx.preset("rush")).toBe("preset");
    expect(port.schedulePreset).toHaveBeenCalledExactlyOnceWith(
      lift.id,
      "rush",
    );
  });

  it("forwards the dialog's announcements", () => {
    const { ctx, deps } = opened();
    ctx.announce("Weekday shown.");
    expect(deps.announce).toHaveBeenCalledExactlyOnceWith("Weekday shown.");
  });

  it("OK writes the schedule once, as one undo step", async () => {
    const { cb, port, deps } = opened();
    const schedule = { cars: [] };
    await cb.apply(schedule);
    expect(port.scheduleShaft).toHaveBeenCalledExactlyOnceWith(
      lift.id,
      scheduleSlots(schedule as never),
    );
    expect(deps.captureUndo).toHaveBeenCalledExactlyOnceWith(
      "Set elevator schedule",
    );
    expect(deps.commitUndo).toHaveBeenCalledOnce();
    expect(deps.announce).toHaveBeenCalledExactlyOnceWith(
      "Elevator schedule saved.",
    );
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
  });

  it("OK on a refused schedule says why; on a shaft that is gone it writes nothing", async () => {
    const refused = opened({ scheduleShaft: () => rec("buildAt", false) });
    await refused.cb.apply({ cars: [] });
    expect(refused.deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "The engine said no.",
      "bad",
    );
    expect(refused.deps.announce).not.toHaveBeenCalled();
    const gone = opened();
    gone.cards.shaft.mockReturnValue(undefined);
    await gone.cb.apply({ cars: [] });
    expect(gone.port.scheduleShaft).not.toHaveBeenCalled();
    expect(gone.deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "That elevator is gone.",
      "bad",
    );
  });
});

describe("EditorActions: extend drag", () => {
  const onLift = { type: "transport" as const, id: lift.id };

  function dragging(steps: Float64Array[], generation = 3) {
    const extendShaft = vi.fn();
    for (const s of steps) extendShaft.mockReturnValueOnce(s);
    return setup(
      {
        generation: () => generation,
        startExtend: () => rec("buildAt", true),
        stopExtend: () => rec("buildAt", true),
        extendShaft,
      },
      onLift,
    );
  }

  it("opens one undo step and one engine extend per drag, and follows each step's ends", () => {
    const { actions, port, deps, cards } = dragging([
      rec("extendShaft", true, { bottom: 1, top: 6, added: 1 }),
      rec("extendShaft", true, { bottom: 1, top: 5, added: 0 }),
    ]);
    actions.extendSelectedTo("up", 6);
    actions.extendSelectedTo("up", 5);
    expect(port.startExtend).toHaveBeenCalledExactlyOnceWith(lift.id);
    expect(deps.captureUndo).toHaveBeenCalledExactlyOnceWith("Extend");
    expect(port.extendShaft).toHaveBeenNthCalledWith(2, lift.id, true, 5);
    expect(
      deps.audio.sfx.mock.calls,
      "a grown floor builds; a shrink clicks",
    ).toEqual([["build"], ["click"]]);
    expect(
      cards.shaft,
      "the drag reads the card once, at its start",
    ).toHaveBeenCalledOnce();
    expect(actions.endExtend(), "the release closes the drag's gesture").toBe(
      true,
    );
    expect(port.stopExtend).toHaveBeenCalledOnce();
  });

  it("a step that moved nothing or was refused is silent", () => {
    const { actions, deps } = dragging([
      rec("extendShaft", true, { bottom: 1, top: 5 }),
      rec("extendShaft", false, { bottom: 1, top: 9 }),
    ]);
    actions.extendSelectedTo("up", 6);
    actions.extendSelectedTo("up", 9);
    expect(deps.audio.sfx).not.toHaveBeenCalled();
    expect(deps.refreshEditor).not.toHaveBeenCalled();
  });

  it("a tower swapped in mid-drag ends it, and the release leaves the new gesture open", () => {
    let generation = 3;
    const s = setup(
      {
        generation: () => generation,
        startExtend: () => rec("buildAt", true),
        stopExtend: () => rec("buildAt", true),
        extendShaft: () =>
          rec("extendShaft", true, { bottom: 1, top: 6, added: 1 }),
      },
      onLift,
    );
    s.actions.extendSelectedTo("up", 6);
    generation = 4;
    s.actions.extendSelectedTo("up", 7);
    expect(s.port.extendShaft).toHaveBeenCalledOnce();
    expect(s.actions.endExtend()).toBe(false);
    expect(
      s.actions.endExtend(),
      "with no drag held the release just closes",
    ).toBe(true);
  });

  it("does not drag a unit, a stairway, or nothing", () => {
    const unit = setup({ generation: () => 3 });
    unit.actions.extendSelectedTo("up", 6);
    const stairs = setup({ generation: () => 3 }, onLift);
    stairs.cards.shaft.mockReturnValue({ ...lift, kind: "stairs" });
    stairs.actions.extendSelectedTo("up", 6);
    for (const s of [unit, stairs])
      expect(s.deps.captureUndo).not.toHaveBeenCalled();
  });
});
