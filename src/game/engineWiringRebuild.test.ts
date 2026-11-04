import { describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { rebuildEngine } from "./engineWiring";

// The real renderer needs WebGL, which a headless run lacks; the rebuild only
// needs a renderer it can wire, configure and start.
const { built } = vi.hoisted(() => ({ built: [] as unknown[] }));
vi.mock("../render/excalibur/TowerEngine", () => ({
  TowerEngine: class {
    preview: unknown = null;
    transportPreview: unknown = null;
    constructor() {
      built.push(this);
    }
    rendersWithWebGL(): boolean {
      return true;
    }
    start(): Promise<void> {
      return Promise.resolve();
    }
    setCamera = vi.fn();
    setReducedMotion = vi.fn();
  },
}));

/**
 * `rebuildEngine` swaps in a fresh renderer after a lost graphics context. The
 * fresh renderer starts with no build ghost, so a ghost the keyboard drew is
 * drawn again on it, and a shaft anchor stays, since the tower is the same.
 */
function appUnderContextLoss() {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const order: string[] = [];
  const app = {
    engine: {
      viewState: () => ({ tile: 1, floor: 2, zoom: 1 }),
      overlayMode: "none",
      dispose: vi.fn(),
      onContextLost: null,
      onContextRestored: null,
    } as unknown,
    canvas,
    build: { clearPaint: vi.fn() },
    inspector: { hide: vi.fn(() => void order.push("hide the card")) },
    commitUndo: vi.fn(() => void order.push("close the gesture")),
    keyboard: {
      followTower: vi.fn((tower: string) => void order.push(`follow on the fresh renderer: ${built.includes(app.engine)}, ${tower}`)),
      pointerDrew: vi.fn(),
    },
    prefs: {},
    reduceMq: { matches: false },
    speed: 1,
    selected: null,
    audio: { start: vi.fn() },
    saveLoad: { recoverFromContextLoss: vi.fn() },
    buildRefusalShowing: false,
  };
  return { app, order };
}

describe("rebuildEngine and the keyboard cursor", () => {
  it("lets the keyboard follow the same tower on the fresh renderer, after the card hide and the gesture close", async () => {
    const { app, order } = appUnderContextLoss();
    await rebuildEngine(app as unknown as GameApp);
    // A follow before the hide would see its refusal card hidden with the latch
    // still set; one before the swap would draw on the disposed renderer.
    expect(order).toEqual(["hide the card", "close the gesture", "follow on the fresh renderer: true, same tower"]);
    expect(app.keyboard.followTower).toHaveBeenCalledOnce();
  });
});
