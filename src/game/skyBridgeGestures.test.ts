import { describe, expect, it, vi } from "vitest";
vi.mock("./buildPreview", () => ({ updateBuildPreview: vi.fn() }));
import { updateBuildPreview } from "./buildPreview";
import { PortCodes } from "../simport/portCodes";
import { catalogFor } from "../tests/catalogFixture";
import { LAYOUT, mockPort } from "../tests/portKit/mockPort";
import type { GameApp } from "../main";
import type { Tool } from "../ui/UI";
import { KeyboardPlay, type KeyboardPlayDeps } from "./keyboardPlay";
import { disarmSkyBridge, placeSkyBridge, tapSkyBridge } from "./skyBridgeGestures";
import { SKY_BRIDGE_STEP } from "./skyBridgeTool";

/**
 * The Sky Bridge tool's gestures over a mock port: a phone's first tap shows
 * the bridge and its price and a second tap on the same bridge lays it as one
 * undo step; a click and the keyboard's Enter lay it at once. The engine's
 * quote and build are spies.
 */

function rec(op: string, slots: Record<string, number>): Float64Array {
  return Float64Array.from(LAYOUT.records[op].map((n) => slots[n] ?? 0));
}

/** A fake app whose engine quotes `answer` at every cell. */
function fakeApp(answer: Record<string, number>, reason = "Point at the gap.") {
  const port = mockPort({ quoteSkyBridge: () => rec("quoteSkyBridge", answer), lastReason: () => reason });
  const steps: string[] = [];
  const app = {
    enginePort: port,
    portCodes: new PortCodes(port),
    captureUndo: vi.fn((label: string) => steps.push(`capture:${label}`)),
    commitUndo: vi.fn(() => steps.push("commit")),
    build: { buildSkyBridge: vi.fn(() => ({ ok: true, tiles: 4 })) },
    engine: { preview: { kind: "lobby" } as unknown },
    ui: { toast: vi.fn() },
  };
  return { app, port, steps, game: app as unknown as GameApp };
}

const BRIDGE = { ok: 1, cost: 44_000, from: 120, to: 124 };

describe("tapSkyBridge", () => {
  it("shows the bridge and its price on a first tap and lays nothing", () => {
    const { app, game } = fakeApp(BRIDGE);
    tapSkyBridge(game, 121, 30);
    expect(updateBuildPreview).toHaveBeenLastCalledWith(game, 121, 30, false);
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith("Sky bridge: 4 tiles, $44,000. Tap it again to build.", "info");
    expect(app.build.buildSkyBridge).not.toHaveBeenCalled();
    expect(app.captureUndo).not.toHaveBeenCalled();
  });

  it("lays the bridge on a second tap on the same bridge, as one undo step", () => {
    const { app, game, steps } = fakeApp(BRIDGE);
    tapSkyBridge(game, 121, 30);
    tapSkyBridge(game, 123, 30);
    expect(app.build.buildSkyBridge).toHaveBeenCalledExactlyOnceWith(123, 30);
    expect(steps).toEqual([`capture:${SKY_BRIDGE_STEP}`, "commit"]);
    expect(app.engine.preview).toBeNull();
  });

  it("forgets the first tap when the tool changes", () => {
    const { app, game } = fakeApp(BRIDGE);
    tapSkyBridge(game, 121, 30);
    disarmSkyBridge(game);
    tapSkyBridge(game, 121, 30);
    expect(app.build.buildSkyBridge).not.toHaveBeenCalled();
  });

  it("says why on a tap the engine refuses, and a later tap there lays nothing", () => {
    const { app, game } = fakeApp({ ok: 0 }, "A sky bridge crosses open air.");
    tapSkyBridge(game, 50, 30);
    tapSkyBridge(game, 50, 30);
    expect(app.ui.toast).toHaveBeenCalledWith("A sky bridge crosses open air.", "bad");
    expect(app.build.buildSkyBridge).not.toHaveBeenCalled();
  });
});

describe("placeSkyBridge", () => {
  it("lays the bridge at once and drops a phone's pending first tap", () => {
    const { app, game } = fakeApp(BRIDGE);
    tapSkyBridge(game, 121, 30);
    expect(placeSkyBridge(game, 121, 30)).toEqual({ ok: true, tiles: 4 });
    // The click consumed the armed bridge: the next tap only shows it again.
    tapSkyBridge(game, 121, 30);
    expect(app.build.buildSkyBridge).toHaveBeenCalledOnce();
  });
});

describe("KeyboardPlay with the Sky Bridge tool", () => {
  function keyboard(laid: { ok: boolean; reason?: string; tiles: number }) {
    const port = mockPort({});
    const steps: string[] = [];
    const announce = vi.fn();
    const placeBridge = vi.fn(() => laid);
    const tool: Tool = { type: "skyBridge" };
    const deps = {
      enginePort: () => port,
      portCodes: () => new PortCodes(port),
      reader: () => ({ tower: { structureKindAt: () => undefined } }) as never,
      catalog: () => catalogFor("modern"),
      isUnlocked: () => true,
      engine: () => ({ ensureVisible: () => {}, preview: null, transportPreview: null }),
      audio: { sfx: vi.fn() },
      ui: { toast: vi.fn() },
      build: { bulldozePicked: vi.fn() },
      tool: () => tool,
      isTransportTool: () => false,
      announce,
      captureUndo: (label: string) => steps.push(`capture:${label}`),
      commitUndo: () => steps.push("commit"),
      pickedAt: () => null,
      selectPicked: vi.fn(),
      placeSimpleBuild: vi.fn(() => null),
      updateBuildPreview: vi.fn(),
      placeSkyBridge: placeBridge,
      refusePausedPlacement: () => false,
    } satisfies KeyboardPlayDeps;
    const kb = new KeyboardPlay(deps);
    kb.moveCursor(0, 0); // reveal the cursor
    announce.mockClear();
    return { kb, deps, steps, announce, placeBridge };
  }

  it("Enter lays the bridge at the cursor as one undo step and says how long it is", () => {
    const { kb, steps, announce, placeBridge, deps } = keyboard({ ok: true, tiles: 4 });
    const c = kb.cursor()!;
    kb.commitCursor();
    expect(placeBridge).toHaveBeenCalledExactlyOnceWith(c.tile, c.floor);
    expect(steps).toEqual([`capture:${SKY_BRIDGE_STEP}`, "commit"]);
    expect(announce).toHaveBeenCalledExactlyOnceWith("Sky bridge built, 4 tiles");
    expect(deps.placeSimpleBuild).not.toHaveBeenCalled();
  });

  it("Enter speaks the engine's reason when it lays nothing", () => {
    const { kb, announce } = keyboard({ ok: false, reason: "A sky bridge crosses open air.", tiles: 0 });
    kb.commitCursor();
    expect(announce).toHaveBeenCalledExactlyOnceWith("A sky bridge crosses open air.");
  });
});
