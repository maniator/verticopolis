import { describe, expect, it, vi } from "vitest";
import { catalogFacility, catalogTileCost } from "../catalog/catalogTypes";
import { viewWorld } from "../presentation/viewWorld";
import { PortCodes } from "../simport/portCodes";
import { catalogFor } from "../tests/catalogFixture";
import { LAYOUT, mockPort } from "../tests/portKit/mockPort";
import { brushTiles } from "../ui/placement";
import { groupDigits } from "../ui/format";
import { BuildActions, type BuildActionsDeps } from "./buildActions";

/**
 * The build controller over a mock port: the command each gesture sends, and
 * the sound and toast it plays for the engine's answer. Whether the engine
 * places, charges or refuses is the Rust engine's, checked by
 * `gameControllersCoverage.integration.test.ts` and the engine's own tests.
 */

const CATALOG = catalogFor("classic");
const WIDE = "office";

/** A command record: status 1 (done) or 0 (refused), then the op's slots. */
function rec(
  op: string,
  ok: boolean,
  slots: Record<string, number> = {},
): Float64Array {
  const all: Record<string, number> = { ...slots, status: ok ? 1 : 0 };
  return Float64Array.from(LAYOUT.records[op].map((n) => all[n] ?? 0));
}

type Answers = Parameters<typeof mockPort>[0];

function setup(
  answers: Answers = {},
  built: (floor: number, x: number) => string | undefined = () => undefined,
) {
  const port = mockPort({
    lastReason: () => "The engine said no.",
    ...answers,
  });
  const codes = new PortCodes(port);
  const tower = {
    structureKindAt: vi.fn(built),
    getUnit: vi.fn((): { id: number } | undefined => undefined),
    getTransport: vi.fn((): { id: number } | undefined => undefined),
  };
  const reader = { tower, update: vi.fn() };
  const deps = {
    enginePort: () => port,
    portCodes: () => codes,
    reader: () => reader as never,
    catalog: () => CATALOG,
    isUnlocked: vi.fn(() => true),
    ui: { toast: vi.fn() },
    audio: { sfx: vi.fn() },
    selectedId: vi.fn((): number | null => null),
    clearSelection: vi.fn(),
  } satisfies BuildActionsDeps;
  return { port, codes, tower, reader, deps, build: new BuildActions(deps) };
}

describe("BuildActions.tryBuild", () => {
  it("builds by kind code, sounding the build", () => {
    const { build, port, codes, deps } = setup({
      buildAt: () => rec("buildAt", true),
    });
    expect(build.tryBuild(WIDE, 3, 10)).toBe(true);
    expect(port.buildAt).toHaveBeenCalledExactlyOnceWith(
      codes.kind(WIDE),
      3,
      10,
    );
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
  });

  it("a refusal errors with the engine's reason; quiet plays nothing either way", () => {
    const { build, deps } = setup({ buildAt: () => rec("buildAt", false) });
    expect(build.tryBuild(WIDE, 3, 10)).toBe(false);
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "The engine said no.",
      "bad",
    );
    expect(build.tryBuild(WIDE, 3, 10, true)).toBe(false);
    expect(deps.audio.sfx).toHaveBeenCalledOnce();
  });
});

describe("BuildActions.tryBuildTransport", () => {
  it("places a span, and a refusal shows the build's own reason", () => {
    const placed = setup({ buildShaft: () => rec("buildAt", true) });
    expect(placed.build.tryBuildTransport("elevatorStandard", 5, 1, 4)).toEqual(
      { ok: true, reason: "" },
    );
    expect(placed.port.buildShaft).toHaveBeenCalledExactlyOnceWith(
      placed.codes.kind("elevatorStandard"),
      5,
      1,
      4,
    );
    expect(placed.deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
    const broke = setup({
      buildShaft: () => rec("buildAt", false),
      lastReason: () => "Not enough money.",
    });
    expect(broke.build.tryBuildTransport("elevatorStandard", 5, 1, 4)).toEqual({
      ok: false,
      reason: "Not enough money.",
    });
    expect(broke.deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "Not enough money.",
      "bad",
    );
  });

  it("a refusal with no reason falls back to the placement diagnosis", () => {
    const lastReason = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce("Floors 2-3 are not built.");
    const { build, port, codes } = setup({
      buildShaft: () => rec("buildAt", false),
      quoteShaft: () => rec("quoteShaft", false),
      lastReason,
    });
    expect(build.tryBuildTransport("stairs", 5, 1, 3)).toEqual({
      ok: false,
      reason: "Floors 2-3 are not built.",
    });
    expect(port.quoteShaft).toHaveBeenCalledExactlyOnceWith(
      codes.kind("stairs"),
      5,
      1,
      3,
    );
  });
});

describe("BuildActions.transportReason", () => {
  it("names a locked kind's star, and falls back to the column rule when the quote gives no reason", () => {
    const locked = setup();
    locked.deps.isUnlocked.mockReturnValue(false);
    const express = catalogFacility(CATALOG, "elevatorExpress");
    expect(locked.build.transportReason("elevatorExpress", 5, 1, 9)).toBe(
      `${express.name} unlocks at ${express.minStar}★.`,
    );
    const quiet = setup({
      quoteShaft: () => rec("quoteShaft", false),
      lastReason: () => undefined,
    });
    expect(quiet.build.transportReason("stairs", 5, 1, 3)).toBe(
      "A shaft can't go here. Leave a clear column through built floors.",
    );
  });
});

describe("BuildActions.paintBrush", () => {
  it("lays the brush strip as one command and answers what was placed", () => {
    const { build, port, codes } = setup({
      paintTiles: () => rec("paintTiles", true, { placed: 3 }),
    });
    expect(build.paintBrush("floor", 20, 4)).toEqual({
      placed: 3,
      reason: undefined,
    });
    expect(port.paintTiles).toHaveBeenCalledExactlyOnceWith(
      codes.kind("floor"),
      4,
      Float64Array.from(brushTiles(20)),
    );
  });

  it("says once that a floor on the ground floor went in as a lobby, at the lobby's price", () => {
    const { build, deps } = setup({
      paintTiles: () => rec("paintTiles", true, { placed: 3 }),
    });
    build.paintBrush("floor", 20, 1);
    const lobby = catalogFacility(CATALOG, "lobby");
    const perTile = catalogTileCost(CATALOG, "lobby", "no floor yet");
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      `The ground floor is a ${lobby.name.toLowerCase()}, so a ${lobby.name.toLowerCase()} ($${groupDigits(perTile)}/tile) went here.`,
      "info",
    );
  });

  it("nothing laid on a strip that already carries the kind reads again and says so", () => {
    const { build, reader } = setup(
      { paintTiles: () => rec("paintTiles", true, { placed: 0 }) },
      () => "floor",
    );
    expect(build.paintBrush("floor", 20, 4)).toEqual({
      placed: 0,
      reason: "Floor already built here",
    });
    expect(reader.update).toHaveBeenCalledOnce();
  });

  it("nothing laid elsewhere passes the engine's reason on", () => {
    const { build, deps } = setup({
      paintTiles: () => rec("paintTiles", false, { placed: 0 }),
    });
    expect(build.paintBrush("floor", 20, 4)).toEqual({
      placed: 0,
      reason: "The engine said no.",
    });
    expect(deps.ui.toast).not.toHaveBeenCalled();
  });

  it("a press past the lot edge that laid nothing says it is the edge of the lot", () => {
    const { build, deps } = setup(
      {
        paintTiles: () => rec("paintTiles", true, { placed: 0 }),
        lastReason: () => undefined,
      },
      () => "floor",
    );
    expect(build.paintBrush("floor", viewWorld().lotWidth + 2, 4)).toEqual({
      placed: 0,
      reason: "That's the edge of the lot.",
    });
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "That's the edge of the lot.",
      "bad",
    );
  });
});

describe("BuildActions paint gestures", () => {
  it("a floor seed paints the brush; a room seed builds once, loudly, snapped on-lot", () => {
    const floor = setup({
      paintTiles: () => rec("paintTiles", true, { placed: 3 }),
    });
    floor.build.seedPaint("floor", 20, 4);
    expect(floor.port.paintTiles).toHaveBeenCalledOnce();
    const room = setup({ buildAt: () => rec("buildAt", true) });
    const edge = viewWorld().lotWidth - 1;
    room.build.seedPaint(WIDE, edge, 4);
    const snapped = viewWorld().lotWidth - catalogFacility(CATALOG, WIDE).width;
    expect(room.port.buildAt).toHaveBeenCalledExactlyOnceWith(
      room.codes.kind(WIDE),
      4,
      snapped,
    );
    expect(room.deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
  });

  it("a drag fills every column from the anchor, quietly, and a new floor reseeds", () => {
    const { build, port, deps } = setup({
      buildAt: () => rec("buildAt", true),
    });
    build.paintFloorRun("floor", 10, 4);
    build.paintFloorRun("floor", 13, 4);
    build.paintFloorRun("floor", 15, 4);
    expect(
      vi.mocked(port.buildAt).mock.calls.map((c) => c[2]),
      "each step runs on from the last",
    ).toEqual([10, 11, 12, 13, 14, 15]);
    build.paintFloorRun("floor", 30, 5);
    expect(port.buildAt).toHaveBeenLastCalledWith(expect.any(Number), 5, 30);
    build.clearPaint();
    build.paintFloorRun("floor", 32, 5);
    expect(
      port.buildAt,
      "a cleared anchor reseeds at the press",
    ).toHaveBeenLastCalledWith(expect.any(Number), 5, 32);
    expect(port.buildAt).toHaveBeenCalledTimes(8);
    expect(deps.audio.sfx).not.toHaveBeenCalled();
  });
});

describe("BuildActions removals", () => {
  it("removes a unit through demolish, a bulldoze flagged as one, and a refusal speaks unless quiet", () => {
    const ok = setup({ demolish: () => rec("demolish", true) });
    expect(ok.build.tryRemoveUnit({ id: 4 }, "bulldoze")).toBe(true);
    expect(ok.port.demolish).toHaveBeenCalledExactlyOnceWith(4, true);
    const refused = setup({ demolish: () => rec("demolish", false) });
    expect(refused.build.tryRemoveUnit({ id: 4 }, "sell")).toBe(false);
    expect(refused.port.demolish).toHaveBeenCalledExactlyOnceWith(4, false);
    expect(refused.deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "The engine said no.",
      "bad",
    );
    expect(refused.build.tryRemoveUnit({ id: 4 }, "sell", true)).toBe(false);
    expect(refused.deps.ui.toast).toHaveBeenCalledOnce();
  });

  it("removes a shaft through demolish and answers whether the engine did", () => {
    const { build, port } = setup({
      demolish: vi
        .fn()
        .mockReturnValueOnce(rec("demolish", true))
        .mockReturnValueOnce(rec("demolish", false)),
    });
    expect(build.removeTransportWithRefund({ id: 9 }, "sell")).toBe(true);
    expect(build.removeTransportWithRefund({ id: 9 }, "bulldoze")).toBe(false);
    expect(port.demolish).toHaveBeenLastCalledWith(9, true);
  });
});

describe("BuildActions.bulldozePicked", () => {
  it("does nothing with no pick", () => {
    expect(setup().build.bulldozePicked(null)).toBe(false);
  });

  it("removes a floor tile by its cell", () => {
    const { build, port, deps } = setup({
      demolishTile: () => rec("demolish", true),
    });
    expect(
      build.bulldozePicked({
        type: "unit",
        id: 0,
        kind: "floor",
        cell: { floor: 3, x: 12 },
      }),
    ).toBe(true);
    expect(port.demolishTile).toHaveBeenCalledExactlyOnceWith(3, 12, true);
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("sell");
    const refused = setup({ demolishTile: () => rec("demolish", false) });
    expect(
      refused.build.bulldozePicked(
        { type: "unit", id: 0, kind: "lobby", cell: { floor: 1, x: 2 } },
        true,
      ),
    ).toBe(false);
    expect(refused.deps.audio.sfx).not.toHaveBeenCalled();
  });

  it("removes a picked unit and drops the selection when it was selected", () => {
    const { build, tower, port, deps } = setup({
      demolish: () => rec("demolish", true),
    });
    tower.getUnit.mockReturnValue({ id: 6 });
    deps.selectedId.mockReturnValue(6);
    expect(build.bulldozePicked({ type: "unit", id: 6, kind: WIDE })).toBe(
      true,
    );
    expect(port.demolish).toHaveBeenCalledExactlyOnceWith(6, true);
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("sell");
    expect(deps.clearSelection).toHaveBeenCalledOnce();
  });

  it("a pick the reader misses reads once more before it is stale", () => {
    const { build, tower, reader, port } = setup({
      demolish: () => rec("demolish", true),
    });
    tower.getTransport
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ id: 8 });
    expect(
      build.bulldozePicked({ type: "transport", id: 8, kind: "stairs" }),
    ).toBe(true);
    expect(reader.update).toHaveBeenCalledOnce();
    expect(port.demolish).toHaveBeenCalledExactlyOnceWith(8, true);
    const stale = setup();
    expect(
      stale.build.bulldozePicked({ type: "unit", id: 8, kind: WIDE }),
    ).toBe(false);
    expect(stale.reader.update).toHaveBeenCalledOnce();
  });

  it("a refused removal plays no sale", () => {
    const unit = setup({ demolish: () => rec("demolish", false) });
    unit.tower.getUnit.mockReturnValue({ id: 6 });
    expect(
      unit.build.bulldozePicked({ type: "unit", id: 6, kind: WIDE }, true),
    ).toBe(false);
    const shaft = setup({ demolish: () => rec("demolish", false) });
    shaft.tower.getTransport.mockReturnValue({ id: 8 });
    expect(
      shaft.build.bulldozePicked({ type: "transport", id: 8, kind: "stairs" }),
    ).toBe(false);
    for (const s of [unit, shaft])
      expect(s.deps.audio.sfx).not.toHaveBeenCalledWith("sell");
  });
});
