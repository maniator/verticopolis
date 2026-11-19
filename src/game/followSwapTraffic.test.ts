import { describe, it, expect, vi } from "vitest";
import { GameApp } from "../main";
import { noteTowerSwap, runningTowerStage } from "./engineFault";
import { currentFileId, setCurrentFile } from "./currentFile";

// Loading main.ts boots the game at module scope; this test only needs the
// class, so the boot is stubbed out.
vi.mock("../bootstrap", () => ({ bootGame: vi.fn() }));
vi.mock("../analyticsTower", async (original) => ({ ...(await original<typeof import("../analyticsTower")>()), nextAnalyticsTower: vi.fn() }));
import { nextAnalyticsTower } from "../analyticsTower";
import type { TrafficTier } from "@verticopolis/components/presentation/traffic";

/**
 * `GameApp.followSwap` restarts the traffic chip's hysteresis on a different
 * tower (a load, a new tower, a slot, an import) and keeps it on a tooling
 * restore, which also keeps the camera, and on an undo or redo step of the
 * same tower, which also keeps the renderer's scene and the tower's latches.
 * We call the real method on a stand-in app that carries only the members it
 * touches.
 */

/** @param stepRaises whether reading the engine finds a raised tower revision, as a step
 *  that moved rooms or shafts leaves it (one that put back only settings raises none, #1802).
 *  @param won whether the tower the engine holds is already rated TOWER. */
function standIn(tier: TrafficTier, stepRaises = true, won = false) {
  const standing = new Set([7]);
  const tower = {
    revision: 41,
    towerName: "Skyspire",
    getUnit: (id: number) => (standing.has(id) ? { id } : undefined),
    getTransport: (id: number) => (standing.has(id) ? { id } : undefined),
  };
  return {
    lastTrafficTier: tier,
    frameErrors: [{ at: "t", message: "old tower" }],
    shownWin: true,
    accMinutes: 0.5,
    // A drag the step cut off: its release never reaches onActionUp.
    paintAnchor: { tile: 3, floor: 2 } as unknown,
    buildAnchor: { tile: 3, floor: 2, oTile: 3, oFloor: 2, lifting: false } as unknown,
    transportStart: { x: 3, floor: 2 } as unknown,
    build: { clearPaint: vi.fn() },
    // The refusal card the drag raised, still up.
    buildRefusalShowing: true,
    inspectAnchor: { tile: 3, floor: 2 } as unknown,
    selected: null as { type: "unit" | "transport"; id: number } | null,
    clearSelection: vi.fn(),
    refreshEditor: vi.fn(),
    personCard: { close: vi.fn() },
    inspector: { clear: vi.fn(), followStep: vi.fn() },
    onboarding: { adoptSim: vi.fn() },
    engine: { setSim: vi.fn(), followStep: vi.fn() },
    renderSim: undefined as unknown,
    // followSwap builds the renderer's view over these two: the layout's heat
    // tables and the reader's tower, crowd and header are all it reads up front.
    enginePort: { viewLayout: () => JSON.stringify({ heatModes: [], heatTints: [] }), evaluatedTower: vi.fn(() => won) },
    reader: { update: vi.fn(() => void (tower.revision += stepRaises ? 1 : 0)), tower, rooms: [{}], structure: [], crowd: { people: [] }, header: { star: 1 } },
    keyboard: { followTower: vi.fn() },
    ui: { resetLog: vi.fn(), update: vi.fn(), showInspector: vi.fn() },
    scheduleReview: { towerArrived: vi.fn() },
  };
}

describe("followSwap and the elevator schedule review", () => {
  it("gives another tower its one look, and an undo or redo step none (#1556)", () => {
    for (const follow of ["swap", "restore"] as const) {
      const app = standIn(0);
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      expect(app.scheduleReview.towerArrived, follow).toHaveBeenCalledOnce();
    }
    const stepped = standIn(0);
    GameApp.prototype.followSwap.call(stepped as unknown as GameApp, "step");
    expect(stepped.scheduleReview.towerArrived).not.toHaveBeenCalled();
  });
});

describe("followSwap and the Bulletin's first line", () => {
  it("opens another tower's Bulletin with the game's arrival line, and keeps the log as it is on a step or a restore", () => {
    const app = standIn(0);
    GameApp.prototype.followSwap.call(app as unknown as GameApp);
    expect(app.ui.resetLog).toHaveBeenCalledWith(expect.anything(), "Loaded Skyspire.");
    for (const follow of ["restore", "step"] as const) {
      const kept = standIn(0);
      GameApp.prototype.followSwap.call(kept as unknown as GameApp, follow);
      expect(kept.ui.resetLog, follow).toHaveBeenCalledWith(expect.anything(), undefined);
    }
  });
});

describe("followSwap and the traffic chip", () => {
  it("starts the chip's hysteresis over on another tower", () => {
    const app = standIn(2);
    GameApp.prototype.followSwap.call(app as unknown as GameApp);
    expect(app.lastTrafficTier).toBe(0);
    expect(app.frameErrors).toEqual([]);
  });

  it("keeps it on a tooling restore and on an undo or redo step", () => {
    for (const follow of ["restore", "step"] as const) {
      const app = standIn(2);
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      expect(app.lastTrafficTier, follow).toBe(2);
    }
  });
});

describe("followSwap and the tower's latches", () => {
  it("starts the win and owed-minute latches and the crash entries over on another tower", () => {
    for (const follow of ["swap", "restore"] as const) {
      const app = standIn(0);
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      expect([app.shownWin, app.accMinutes, app.frameErrors], follow).toEqual([false, 0, []]);
    }
  });

  it("counts a tower that arrives already rated TOWER as congratulated, so a load does not open them again (#1134)", () => {
    for (const follow of ["swap", "restore"] as const) {
      const app = standIn(0, true, true);
      app.shownWin = false;
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      expect(app.shownWin, follow).toBe(true);
      expect(app.enginePort.evaluatedTower, follow).toHaveBeenCalled();
    }
  });

  it("keeps them through an undo or redo step, so a won tower is not congratulated again", () => {
    const app = standIn(0);
    GameApp.prototype.followSwap.call(app as unknown as GameApp, "step");
    expect(app.shownWin, "the TOWER congratulations were already shown").toBe(true);
    expect(app.accMinutes, "time is not rewound, so the owed minutes stay").toBe(0.5);
    expect(app.frameErrors, "the same tower's crash context").toHaveLength(1);
  });
});

describe("followSwap and what every follow refreshes", () => {
  it("reads the star level and rebases the UI log for each follow kind, and clears the selection on another tower", () => {
    for (const follow of ["step", "restore", "swap"] as const) {
      const app = standIn(0);
      app.reader.header.star = 4;
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      expect(app.clearSelection, follow).toHaveBeenCalledTimes(follow === "step" ? 0 : 1);
      expect((app as unknown as { lastStar: number }).lastStar, `${follow}: the palette's star level`).toBe(4);
      expect(app.ui.resetLog, `${follow}: old log entries do not replay as toasts`).toHaveBeenCalledOnce();
      expect(app.ui.update, follow).toHaveBeenCalledOnce();
    }
  });
});

describe("followSwap and the selection through a step (#1802)", () => {
  it("keeps a selection whose facility the step left, and reads its card again", () => {
    for (const type of ["unit", "transport"] as const) {
      const app = standIn(0);
      app.selected = { type, id: 7 };
      GameApp.prototype.followSwap.call(app as unknown as GameApp, "step");
      expect(app.clearSelection, type).not.toHaveBeenCalled();
      expect(app.refreshEditor, type).toHaveBeenCalledOnce();
      expect(app.selected, type).toEqual({ type, id: 7 });
    }
  });

  it("clears a selection whose facility the step took away", () => {
    for (const type of ["unit", "transport"] as const) {
      const app = standIn(0);
      app.selected = { type, id: 8 };
      GameApp.prototype.followSwap.call(app as unknown as GameApp, "step");
      expect(app.clearSelection, type).toHaveBeenCalledOnce();
      expect(app.refreshEditor, type).not.toHaveBeenCalled();
    }
  });

  it("hands the inspector what still stands, and keeps its ✕-latch out of a reset", () => {
    const app = standIn(0);
    GameApp.prototype.followSwap.call(app as unknown as GameApp, "step");
    expect(app.inspector.clear).not.toHaveBeenCalled();
    const stands = vi.mocked(app.inspector.followStep).mock.calls[0][0] as (t: { type: "unit" | "transport"; id: number }) => boolean;
    expect([stands({ type: "unit", id: 7 }), stands({ type: "transport", id: 7 }), stands({ type: "unit", id: 8 })]).toEqual([true, true, false]);
    expect(app.personCard.close, "a person's card may name a room the step took").toHaveBeenCalledOnce();
  });
});

describe("followSwap and the renderer", () => {
  it("hands another tower to the renderer as a new view", () => {
    const app = standIn(0);
    GameApp.prototype.followSwap.call(app as unknown as GameApp);
    expect(app.engine.setSim).toHaveBeenCalledExactlyOnceWith(app.renderSim, { keepCamera: false });
    expect(app.engine.followStep).not.toHaveBeenCalled();
  });

  it("hands a tooling restore to the renderer as a new view under the same camera", () => {
    const app = standIn(0);
    GameApp.prototype.followSwap.call(app as unknown as GameApp, "restore");
    expect(app.engine.setSim).toHaveBeenCalledExactlyOnceWith(app.renderSim, { keepCamera: true });
    expect(app.engine.followStep).not.toHaveBeenCalled();
  });

  it("keeps the renderer's view and scene through an undo or redo step", () => {
    const app = standIn(2);
    const view = { drawn: "the tower before the step" };
    app.renderSim = view;
    GameApp.prototype.followSwap.call(app as unknown as GameApp, "step");
    expect(app.engine.followStep).toHaveBeenCalledOnce();
    expect(app.engine.setSim).not.toHaveBeenCalled();
    expect(app.renderSim).toBe(view);
    expect(app.reader.update, "the reader still reads the changed tower").toHaveBeenCalledOnce();
    expect(app.lastTrafficTier).toBe(2);
  });

  it("starts the view over for a follow value it does not know", () => {
    // Typed callers cannot pass one, but a tooling or e2e caller in plain
    // JavaScript could: it is treated as another tower.
    const app = standIn(2);
    GameApp.prototype.followSwap.call(app as unknown as GameApp, "rewind" as never);
    expect(app.engine.setSim).toHaveBeenCalledExactlyOnceWith(app.renderSim, { keepCamera: false });
    expect([app.shownWin, app.lastTrafficTier]).toEqual([false, 0]);
  });

  it("leaves the scene alone for a step that put back only settings and raised no revision (#1802)", () => {
    const app = standIn(2, false);
    const view = { drawn: "the tower before the step" };
    app.renderSim = view;
    GameApp.prototype.followSwap.call(app as unknown as GameApp, "step");
    expect(app.engine.setSim).not.toHaveBeenCalled();
    expect(app.engine.followStep).not.toHaveBeenCalled();
    expect(app.renderSim).toBe(view);
    expect(app.reader.update, "names reach the rooms through the reader").toHaveBeenCalledOnce();
    expect(app.shownWin, "still a step of the same tower").toBe(true);
  });
});

describe("followSwap and the title screen and trap report", () => {
  it("keeps a title screen up and names the stage undo for a step or a restore, and adopt for a swap", () => {
    const seen = (["step", "restore", "swap"] as const).map((follow) => {
      const app = standIn(0);
      noteTowerSwap(follow === "swap"); // the opposite stage, so a row cannot pass on the last one's
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      return [follow, vi.mocked(app.onboarding.adoptSim).mock.calls[0]?.[1], runningTowerStage()];
    });
    expect(seen).toEqual([
      ["step", true, "undo"],
      ["restore", true, "undo"],
      ["swap", false, "adopt"],
    ]);
  });
});

describe("followSwap and a drag under way", () => {
  it("drops the drag's anchors, painted run and refusal card when Undo lands mid-drag, and on any other tower", () => {
    for (const follow of ["step", "restore", "swap"] as const) {
      const app = standIn(0);
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      expect([app.paintAnchor, app.buildAnchor, app.transportStart], follow).toEqual([null, null, null]);
      expect(app.build.clearPaint, follow).toHaveBeenCalledOnce();
      expect([app.buildRefusalShowing, app.inspectAnchor], `${follow}: the refusal card's latch`).toEqual([false, null]);
      expect(app.ui.showInspector, `${follow}: the refusal card`).toHaveBeenCalledWith(null);
    }
  });

  it("lets the keyboard cursor follow last, after the card hides and the renderer's input reset", () => {
    // Each of those clears what the keyboard follow may draw again: the ghost and
    // its refusal card (the refusal drop and the inspector both hide the shared card).
    for (const follow of ["step", "restore", "swap"] as const) {
      const app = standIn(0);
      const order: string[] = [];
      app.ui.showInspector.mockImplementation(() => void order.push("refusal card"));
      app.inspector.clear.mockImplementation(() => void order.push("inspector"));
      app.inspector.followStep.mockImplementation(() => void order.push("inspector"));
      app.engine.followStep.mockImplementation(() => void order.push("reset"));
      app.engine.setSim.mockImplementation(() => void order.push("reset"));
      app.keyboard.followTower.mockImplementation((tower: string) => void order.push(`follow: ${tower}`));
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      expect(order[order.length - 1], follow).toBe(`follow: ${follow === "step" ? "same tower" : "another tower"}`);
      expect(order.slice(0, -1).sort(), `${follow}: everything before the follow`).toEqual(["inspector", "refusal card", "reset"]);
    }
  });
});

describe("followSwap and the live tower's My Towers file", () => {
  it("forgets the file on another tower, so File > Save writes only the Auto-save", () => {
    for (const follow of ["swap", "restore"] as const) {
      setCurrentFile("old tower");
      const app = standIn(1);
      GameApp.prototype.followSwap.call(app as unknown as GameApp, follow);
      expect(currentFileId(), follow).toBeNull();
    }
  });

  it("keeps it on an undo or redo step of the same tower", () => {
    setCurrentFile("this tower");
    const app = standIn(1);
    GameApp.prototype.followSwap.call(app as unknown as GameApp, "step");
    expect(currentFileId()).toBe("this tower");
  });
});

describe("followSwap and the first-tower funnel's tower number (#2392)", () => {
  it("moves the number on for another tower, a restore included, and keeps it on an undo or redo step", () => {
    vi.mocked(nextAnalyticsTower).mockClear();
    GameApp.prototype.followSwap.call(standIn(0) as unknown as GameApp);
    expect(nextAnalyticsTower).toHaveBeenCalledTimes(1);
    GameApp.prototype.followSwap.call(standIn(0) as unknown as GameApp, "restore");
    expect(nextAnalyticsTower).toHaveBeenCalledTimes(2);
    GameApp.prototype.followSwap.call(standIn(0) as unknown as GameApp, "step");
    expect(nextAnalyticsTower, "a step is the same tower").toHaveBeenCalledTimes(2);
  });
});
