import { describe, expect, it, vi } from "vitest";
import type { TowerEngine } from "./TowerEngine";
import { bakeSharedGraphics } from "./towerScene";

// The bake allocates `ex.Canvas` objects a Node test cannot render, so the
// stand-in keeps each canvas's options and the test runs its `draw` on a
// recording context: what the shared entrance graphics paint is what a
// player sees on every tower that uses them.
vi.mock("excalibur", async (importOriginal) => ({
  ...(await importOriginal<typeof import("excalibur")>()),
  Canvas: class {
    constructor(readonly options: { cache?: boolean; draw: (ctx: CanvasRenderingContext2D) => void }) {}
  },
}));
vi.mock("./peopleGfx", () => ({ bakePeople: () => ({}) }));

type Baked = { options: { cache?: boolean; draw: (ctx: CanvasRenderingContext2D) => void } };

/** Everything `gfx` paints, as the fill styles it sets, in order. */
function fills(gfx: unknown): string[] {
  const log: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => ({ addColorStop: () => {} })),
    set: (target, key, value) => {
      if (key === "fillStyle") log.push(String(value));
      target[key] = value;
      return true;
    },
  });
  (gfx as Baked).options.draw(ctx as unknown as CanvasRenderingContext2D);
  return log;
}

/** The doorman's collar and cuffs, painted by no other part of the entrance. */
const DOORMAN = "#c9a94c";

function baked(): TowerEngine {
  const engine = { d: { anim: 0 } } as unknown as TowerEngine;
  bakeSharedGraphics(engine);
  return engine;
}

describe("each tower's entrance shows its staff only while someone is in it (#552, #2384)", () => {
  it("bakes a staffed grand entrance with the doorman and an empty one without", () => {
    const engine = baked();
    for (const lit of [0, 1]) {
      expect(fills(engine.entranceGrandRightGfx[lit])).toContain(DOORMAN);
      expect(fills(engine.entranceGrandSoloGfx[lit])).toContain(DOORMAN);
      expect(fills(engine.entranceEmptyGfx["grand-right"][lit])).not.toContain(DOORMAN);
      expect(fills(engine.entranceEmptyGfx["grand-solo"][lit])).not.toContain(DOORMAN);
    }
  });

  it("animates only the staffed doors, so an empty tower's entrance stays a static bake", () => {
    const engine = baked();
    expect((engine.entranceGrandRightGfx[0] as unknown as Baked).options.cache).toBe(false);
    expect((engine.entranceEmptyGfx["grand-right"][0] as unknown as Baked).options.cache).toBe(true);
  });

  it("gives a tall lobby's doors story a staffed and an empty slice, and shares the stories above", () => {
    const engine = baked();
    const staffed = engine.tallLobbyGfx(false, true, 2, 0, "grand-right", true);
    const empty = engine.tallLobbyGfx(false, true, 2, 0, "grand-right", false);
    expect(staffed).not.toBe(empty);
    expect(fills(staffed)).toContain(DOORMAN);
    expect(fills(empty)).not.toContain(DOORMAN);
    expect(engine.tallLobbyGfx(false, true, 2, 1, "grand-right", true)).toBe(engine.tallLobbyGfx(false, true, 2, 1, "grand-right", false));
  });
});
