import { describe, expect, it, vi } from "vitest";
import {
  INVALID_COMMAND,
  MAX_TEXT,
  NOT_ENOUGH_MONEY,
} from "../simport/request";
import { priceOptionsFor } from "../ui/catalogPricing";
import {
  CATALOG,
  lift,
  office,
  rec,
  root,
  setup,
} from "./editorActions.fixture";

vi.mock("../simport/headerClock", () => ({
  clockOf: () => ({ hour: 9, isWeekend: true }),
}));

/**
 * The editor card's actions over a mock port: the commands each button sends,
 * the undo steps it opens and closes, and what it does with the engine's
 * answers (sound, toast, refresh). What the engine does with a command (the
 * charge, the refusal) is the Rust engine's, checked by
 * `gameControllersCoverage.integration.test.ts` and the engine's own tests.
 */

describe("EditorActions: unit card", () => {
  it("sells through the shared refund path, then closes the step and the selection", async () => {
    const { actions, deps } = setup();
    await actions.handleEditAction("sell", root(""));
    expect(deps.captureUndo).toHaveBeenCalledExactlyOnceWith("Sell");
    expect(deps.build.tryRemoveUnit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: office.id }),
      "sell",
    );
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("sell");
    expect(deps.commitUndo).toHaveBeenCalledOnce();
    expect(deps.clearSelection).toHaveBeenCalledOnce();
  });

  it("a refused sale plays nothing and keeps the selection", async () => {
    const { actions, deps } = setup();
    deps.build.tryRemoveUnit.mockReturnValue(false);
    await actions.handleEditAction("sell", root(""));
    expect(deps.audio.sfx).not.toHaveBeenCalled();
    expect(deps.commitUndo).not.toHaveBeenCalled();
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("clears a selection whose unit is gone, and does nothing with no selection", async () => {
    const gone = setup({}, { type: "unit", id: 99 });
    await gone.actions.handleEditAction("rename", root(""));
    expect(gone.deps.clearSelection).toHaveBeenCalledOnce();
    const none = setup({}, null);
    await none.actions.handleEditAction("rename", root(""));
    expect(none.deps.captureUndo).not.toHaveBeenCalled();
  });

  it("renames through labelUnit, and refuses an over-long name before the port", async () => {
    const { actions, deps, port } = setup({
      labelUnit: () => rec("labelUnit", true),
    });
    await actions.handleEditAction(
      "rename",
      root('<input id="ed-name" value="Acme">'),
    );
    expect(port.labelUnit).toHaveBeenCalledExactlyOnceWith(office.id, "Acme");
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("click");
    expect(deps.refreshEditor).toHaveBeenCalledOnce();
    expect(deps.commitUndo).toHaveBeenCalledOnce();

    const long = setup({ labelUnit: () => rec("labelUnit", true) });
    await long.actions.handleEditAction(
      "rename",
      root(`<input id="ed-name" value="${"x".repeat(MAX_TEXT + 1)}">`),
    );
    expect(long.port.labelUnit).not.toHaveBeenCalled();
    expect(long.deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      INVALID_COMMAND,
      "bad",
    );
    expect(long.deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
  });

  it("a refused rename toasts the engine's reason and commits no step", async () => {
    const { actions, deps } = setup({
      labelUnit: () => rec("labelUnit", false),
    });
    await actions.handleEditAction(
      "rename",
      root('<input id="ed-name" value="Acme">'),
    );
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "The engine said no.",
      "bad",
    );
    expect(deps.commitUndo).not.toHaveBeenCalled();
  });

  it("steps the rent up and down, sounding only when the engine took the step", async () => {
    const { actions, deps, port } = setup({
      stepRent: (_id: number, dir: number) => rec("buildAt", dir > 0),
    });
    await actions.handleEditAction("rentUp", root(""));
    await actions.handleEditAction("rentDown", root(""));
    expect(port.stepRent).toHaveBeenNthCalledWith(1, office.id, 1);
    expect(port.stepRent).toHaveBeenNthCalledWith(2, office.id, -1);
    expect(deps.audio.sfx).toHaveBeenCalledOnce();
    expect(deps.refreshEditor).toHaveBeenCalledOnce();
    expect(deps.captureUndo).toHaveBeenCalledWith("Rent change");
  });

  it("a rung sets the rung's rent and announces it; No Rate takes the unit off the market", async () => {
    const rungs = priceOptionsFor(CATALOG, "office");
    if (rungs?.shape !== "ladder")
      throw new Error("the classic office prices by rungs");
    const { actions, deps, port } = setup({
      setRent: () => rec("buildAt", true),
      noRate: () => rec("buildAt", true),
    });
    await actions.handleEditAction(
      "rung",
      root(
        '<select id="ed-rung"><option value="1" selected></option></select>',
      ),
    );
    expect(port.setRent).toHaveBeenCalledExactlyOnceWith(
      office.id,
      rungs.rungs[1].value,
    );
    expect(deps.announce).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^Rent set to ${rungs.rungs[1].label} \\(\\$`),
      ),
    );
    await actions.handleEditAction(
      "rung",
      root(
        '<select id="ed-rung"><option value="noRate" selected></option></select>',
      ),
    );
    expect(port.noRate).toHaveBeenCalledExactlyOnceWith(office.id);
    expect(deps.announce).toHaveBeenLastCalledWith(
      "No Rate: off the market. Charges nothing; no one moves in.",
    );
    expect(deps.refreshEditor).toHaveBeenCalledTimes(2);
  });

  it("names a condo's price a sale price and a hotel's a room rate", async () => {
    for (const [kind, what] of [
      ["condo", "Sale price"],
      ["hotelSingle", "Room rate"],
    ] as const) {
      const s = setup({ setRent: () => rec("buildAt", true) });
      s.cards.unit.mockReturnValue({
        id: office.id,
        kind,
        filmPolicy: undefined,
      });
      await s.actions.handleEditAction(
        "rung",
        root(
          '<select id="ed-rung"><option value="0" selected></option></select>',
        ),
      );
      expect(s.deps.announce).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${what} set to `)),
      );
    }
  });

  it("a refused rung still refreshes the card, so the picker snaps back", async () => {
    const { actions, deps } = setup({ setRent: () => rec("buildAt", false) });
    await actions.handleEditAction(
      "rung",
      root(
        '<select id="ed-rung"><option value="0" selected></option></select>',
      ),
    );
    expect(deps.announce).not.toHaveBeenCalled();
    expect(deps.refreshEditor).toHaveBeenCalledOnce();
  });

  it("cycles the film policy auto, feature, blockbuster and back", async () => {
    const { actions, cards, codes, port } = setup({
      setFilm: () => rec("buildAt", true),
    });
    for (const [now, next] of [
      [undefined, "feature"],
      ["feature", "blockbuster"],
      ["blockbuster", "auto"],
    ] as const) {
      cards.unit.mockReturnValueOnce({
        id: office.id,
        kind: "cinema",
        filmPolicy: now,
      });
      await actions.handleEditAction("filmPolicy", root(""));
      expect(port.setFilm).toHaveBeenLastCalledWith(
        office.id,
        codes.code("filmPolicies", next),
      );
    }
  });

  it("rerolls a shop's variety, sounding only when the engine rerolled it", async () => {
    const { actions, deps, port } = setup({
      rerollUnit: vi
        .fn()
        .mockReturnValueOnce(rec("buildAt", true))
        .mockReturnValueOnce(rec("buildAt", false)),
    });
    await actions.handleEditAction("changeVariety", root(""));
    await actions.handleEditAction("changeVariety", root(""));
    expect(port.rerollUnit).toHaveBeenCalledTimes(2);
    expect(deps.audio.sfx).toHaveBeenCalledOnce();
  });

  it("opens the batch pricing dialog wired to the engine's preview and apply", async () => {
    const counts = { matched: 4, eligible: 3, changed: 2, skippedSold: 1 };
    const { actions, deps, port, codes, kit } = setup({
      rentBatch: () => rec("rentBatch", true, counts),
    });
    await actions.handleEditAction("batchKind", root(""));
    const [ctx, cb] = deps.ui.showBatchPricingDialog.mock
      .calls[0] as unknown as [
      { kind: string; kindLabel: string },
      Record<string, (...a: unknown[]) => unknown>,
    ];
    expect(ctx).toMatchObject({ kind: "office", kindLabel: "Office" });
    expect(cb.preview(2, {})).toEqual({ matched: 3 });
    expect(kit.previewRentBatch).toHaveBeenCalledExactlyOnceWith(
      "office",
      2,
      {},
    );
    const summed = await cb.apply("noRate", { onlyDefaultPriced: true });
    expect(port.rentBatch).toHaveBeenCalledExactlyOnceWith(
      codes.kind("office"),
      -1,
      true,
    );
    expect(summed).toMatchObject(counts);
    expect(deps.captureUndo).toHaveBeenLastCalledWith("Set prices");
    cb.onApplied("4 offices repriced.");
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "4 offices repriced.",
      "good",
    );
    expect(deps.announce).toHaveBeenCalledExactlyOnceWith(
      "4 offices repriced.",
    );
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
  });

  it("a refused batch says why and hands the dialog no summary", async () => {
    const { actions, deps } = setup({
      rentBatch: () => rec("rentBatch", false),
    });
    await actions.handleEditAction("batchKind", root(""));
    const cb = deps.ui.showBatchPricingDialog.mock.calls[0][1] as unknown as {
      apply(t: unknown, o: object): Promise<unknown>;
    };
    expect(await cb.apply("default", {})).toBeNull();
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "The engine said no.",
      "bad",
    );
  });
});

describe("EditorActions: shaft card", () => {
  const onLift = { type: "transport" as const, id: lift.id };

  it("sells a shaft through the shared refund path", async () => {
    const { actions, deps } = setup({}, onLift);
    await actions.handleEditAction("sell", root(""));
    expect(
      deps.build.removeTransportWithRefund,
    ).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: lift.id }),
      "sell",
    );
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("sell");
    expect(deps.clearSelection).toHaveBeenCalledOnce();
    const refused = setup({}, onLift);
    refused.deps.build.removeTransportWithRefund.mockReturnValue(false);
    await refused.actions.handleEditAction("sell", root(""));
    expect(refused.deps.audio.sfx).not.toHaveBeenCalled();
    expect(refused.deps.clearSelection).toHaveBeenCalledOnce();
  });

  it("clears a selection whose shaft is gone", async () => {
    const { actions, deps } = setup({}, { type: "transport", id: 99 });
    await actions.handleEditAction("addcar", root(""));
    expect(deps.clearSelection).toHaveBeenCalledOnce();
  });

  it("adds and removes cars, and only the money refusal speaks", async () => {
    const { actions, deps, port, cards } = setup(
      {
        changeCars: vi
          .fn()
          .mockReturnValueOnce(rec("buildAt", true))
          .mockReturnValueOnce(rec("buildAt", true)),
      },
      onLift,
    );
    await actions.handleEditAction("addcar", root(""));
    await actions.handleEditAction("removecar", root(""));
    expect(port.changeCars).toHaveBeenNthCalledWith(1, lift.id, true);
    expect(port.changeCars).toHaveBeenNthCalledWith(2, lift.id, false);
    expect(deps.audio.sfx.mock.calls).toEqual([["build"], ["click"]]);
    expect(cards.forget).toHaveBeenCalledTimes(2);

    const broke = setup(
      {
        changeCars: () => rec("buildAt", false),
        lastReason: () => NOT_ENOUGH_MONEY,
      },
      onLift,
    );
    await broke.actions.handleEditAction("addcar", root(""));
    expect(broke.deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      NOT_ENOUGH_MONEY,
      "bad",
    );
    const capped = setup(
      {
        changeCars: () => rec("buildAt", false),
        lastReason: () => "At the car limit.",
      },
      onLift,
    );
    await capped.actions.handleEditAction("addcar", root(""));
    expect(capped.deps.ui.toast).not.toHaveBeenCalled();
    expect(capped.deps.audio.sfx).not.toHaveBeenCalled();
  });

  it("the extend buttons ask for one floor past the shaft's end", async () => {
    const { actions, deps, port } = setup(
      { extendShaft: () => rec("extendShaft", true) },
      onLift,
    );
    await actions.handleEditAction("extendUp", root(""));
    await actions.handleEditAction("extendDown", root(""));
    expect(port.extendShaft).toHaveBeenNthCalledWith(
      1,
      lift.id,
      true,
      lift.top + 1,
    );
    expect(port.extendShaft).toHaveBeenNthCalledWith(
      2,
      lift.id,
      false,
      lift.bottom - 1,
    );
    expect(deps.audio.sfx.mock.calls).toEqual([["build"], ["build"]]);
    expect(deps.commitUndo).toHaveBeenCalledTimes(2);
  });

  it("a refused extend errors with the engine's reason; short of money it commits no step", async () => {
    const blocked = setup(
      {
        extendShaft: () => rec("extendShaft", false),
        lastReason: () => "Another shaft is in the way.",
      },
      onLift,
    );
    await blocked.actions.handleEditAction("extendUp", root(""));
    expect(blocked.deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
    expect(blocked.deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "Another shaft is in the way.",
      "bad",
    );
    expect(blocked.deps.commitUndo).toHaveBeenCalledOnce();
    const broke = setup(
      {
        extendShaft: () => rec("extendShaft", false),
        lastReason: () => NOT_ENOUGH_MONEY,
      },
      onLift,
    );
    await broke.actions.handleEditAction("extendUp", root(""));
    expect(broke.deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      NOT_ENOUGH_MONEY,
      "bad",
    );
    expect(broke.deps.commitUndo).not.toHaveBeenCalled();
  });

  it("the schedule button opens the shaft's schedule dialog", async () => {
    const { actions, deps } = setup({}, onLift);
    await actions.handleEditAction("schedule", root(""));
    expect(deps.ui.showElevatorScheduleDialog).toHaveBeenCalledOnce();
  });
});

describe("EditorActions.renameTower", () => {
  it("names the tower, refusing an over-long name before the port and a refused one with its reason", () => {
    const { actions, port, deps } = setup({
      nameTower: vi
        .fn()
        .mockReturnValueOnce(rec("buildAt", true))
        .mockReturnValueOnce(rec("buildAt", false)),
    });
    actions.renameTower("Spire");
    expect(port.nameTower).toHaveBeenCalledExactlyOnceWith("Spire");
    expect(deps.ui.toast).not.toHaveBeenCalled();
    actions.renameTower("x".repeat(MAX_TEXT + 1));
    expect(port.nameTower).toHaveBeenCalledOnce();
    expect(deps.ui.toast).toHaveBeenLastCalledWith(INVALID_COMMAND, "bad");
    actions.renameTower("Spire II");
    expect(deps.ui.toast).toHaveBeenLastCalledWith(
      "The engine said no.",
      "bad",
    );
  });
});
