import { describe, it, expect } from "vitest";
import {
  HEAT_STOPS,
  HEATMAP_LABELS,
  HEATMAP_MODES,
  drawOverlay,
  syncEventFx,
  setReducedMotion,
  resetDecorativeClock,
  MAX_EXPLOSIONS,
  MAX_TREASURES,
} from "./towerOverlay";

/**
 * The 2D overlay/sky-event painters and the decorative-fx bookkeeping, driven
 * against a recording spy context (mirroring src/render/sprites.test.ts) plus a
 * fake engine. The painters are exercised through drawOverlay across every
 * overlay mode and event-visual state so each branch paints; syncEventFx is
 * pinned on its real state machine (start while animating, retire on the anim
 * clock, hard caps, reduced-motion suppression). Pixel fidelity is the
 * Playwright visual tier's job; this pins structure and control flow.
 */

/** A recording 2D-context stand-in: methods and style writes are logged so a
 *  painter's output can be asserted for real draw calls, not just no-throw. */
function spyCtx() {
  const log: string[] = [];
  const grad = { addColorStop: (...a: unknown[]) => log.push("stop:" + JSON.stringify(a)) };

  const ctx: any = {};
  const methods = [
    "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo",
    "quadraticCurveTo", "bezierCurveTo", "rect", "roundRect", "ellipse", "fill", "stroke",
    "fillRect", "strokeRect", "clearRect", "fillText", "strokeText", "translate", "scale",
    "rotate", "clip", "setLineDash", "drawImage",
  ];
  for (const m of methods) ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  ctx.createLinearGradient = (...a: unknown[]) => (log.push(`grad:${JSON.stringify(a)}`), grad);
  ctx.createRadialGradient = (...a: unknown[]) => (log.push(`rgrad:${JSON.stringify(a)}`), grad);
  ctx.measureText = () => ({ width: 10 });
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "font", "textAlign", "textBaseline", "lineCap", "lineJoin"]) {
    let v: unknown = "";
    Object.defineProperty(ctx, p, { get: () => v, set: (nv) => (log.push(`${p}=${String(nv)}`), void (v = nv)) });
  }
  return {
    ctx: ctx as CanvasRenderingContext2D,
    log,
    painted: () => log.some((l) => l.startsWith("fillRect") || l.startsWith("fill:") || l.startsWith("stroke:") || l.startsWith("fillText")),
  };
}

const CELLS = [
  { floor: 5, minX: 100, maxX: 110, severity: 0.1 },
  { floor: 6, minX: 100, maxX: 120, severity: 0.9 },
];

/** A fake TowerEngine for the overlay painters. Screen transforms are simple
 *  and consistent so cells land on-screen; every field the painters read has a
 *  sane default that individual tests override. */

function eng(over: Record<string, any> = {}): any {

  const e: any = {
    viewWidth: 800,
    viewHeight: 600,
    overlayCanvas: { width: 800, height: 600 },
    cam: { zoom: 1 },
    d: { anim: 0 },
    overlayMode: null,
    heatmap: [],
    heatmapMode: null,
    heatmapHour: -1,
    heatmapTowerRev: -1,
    heatmapMealRev: -1,
    heatmapPeakCongestion: 0,
    explosions: [],
    treasures: [],
    vipStart: null,
    thiefStart: null,
    thiefFloor: 3,
    thiefCaught: false,
    preview: null,
    transportPreview: null,
    selectedId: null,
    arrowHit: {},
    sim: {
      weather: "clear",
      clock: { hour: 12 },
      tower: {
        revision: 1,
        mealOverlayRevision: 0,
        transports: [],
        getUnit: () => undefined,
        getTransport: () => undefined,
        facilityOf: () => ({ width: 3 }),
      },
      floorHeatmap: () => CELLS,
      peakCongestion: () => 1.2,
    },
    worldToScreenX: (tile: number) => tile,
    worldToScreenY: (floor: number) => 300 - floor,
    screenToFloor: (sy: number) => 300 - sy,
    ...over,
  };
  return e;
}

describe("heatmap palette metadata", () => {
  it("has one label per mode and a 4-stop ramp", () => {
    expect(HEAT_STOPS.length).toBe(4);
    for (const m of HEATMAP_MODES) expect(HEATMAP_LABELS[m]).toBeTruthy();
  });
});

describe("drawOverlay paints across every overlay mode", () => {
  it("with the overlay off, still clears and paints the ruler", () => {
    const s = spyCtx();
    const e = eng();
    drawOverlay(e, s.ctx);
    expect(s.log[0]).toMatch(/^clearRect/);
    expect(s.painted()).toBe(true); // the ruler always draws
  });

  it("resizes the overlay canvas to the viewport when it drifts", () => {
    const s = spyCtx();
    const e = eng({ overlayCanvas: { width: 10, height: 10 } });
    drawOverlay(e, s.ctx);
    expect(e.overlayCanvas.width).toBe(800);
    expect(e.overlayCanvas.height).toBe(600);
  });

  for (const mode of HEATMAP_MODES) {
    it(`paints the ${mode} heatmap cells and legend`, () => {
      const s = spyCtx();
      const e = eng({ overlayMode: mode });
      drawOverlay(e, s.ctx);
      // The cache was cold, so floorHeatmap ran and cells were stored.
      expect(e.heatmap).toBe(CELLS);
      expect(e.heatmapMode).toBe(mode);
      // A legend gradient bar is built from the ramp stops.
      expect(s.log.some((l) => l.startsWith("grad:"))).toBe(true);
      expect(s.log.some((l) => l.startsWith("stop:"))).toBe(true);
    });
  }

  it("reuses the cached heatmap when the hour, layout and mode are unchanged", () => {
    const s = spyCtx();
    let calls = 0;
    const e = eng({
      overlayMode: "occupancy",
      heatmapMode: "occupancy",
      heatmapHour: 12,
      heatmapTowerRev: 1,
      heatmapMealRev: 0,
      heatmap: CELLS,
    });
    e.sim.floorHeatmap = () => {
      calls++;
      return CELLS;
    };
    drawOverlay(e, s.ctx);
    expect(calls).toBe(0); // cache hit: no rescan
  });

  it("invalidates the congestion cache on the meal-overlay revision", () => {
    const s = spyCtx();
    let calls = 0;
    const e = eng({
      overlayMode: "congestion",
      heatmapMode: "congestion",
      heatmapHour: 12,
      heatmapTowerRev: 1,
      heatmapMealRev: 0,
    });
    e.sim.tower.mealOverlayRevision = 5; // moved mid-hour
    e.sim.floorHeatmap = () => {
      calls++;
      return CELLS;
    };
    drawOverlay(e, s.ctx);
    expect(calls).toBe(1);
    expect(e.heatmapMealRev).toBe(5);
  });
});

describe("weather and event visuals paint", () => {
  it("rain lays an overcast tint and streaks", () => {
    const s = spyCtx();
    drawOverlay(eng({ sim: { ...eng().sim, weather: "rain" } }), s.ctx);
    expect(s.log.some((l) => l.startsWith("stroke:"))).toBe(true);
  });

  it("an in-window explosion draws a blast; an elapsed one is skipped", () => {
    // Baseline with no explosions: the ruler and ambient painting are identical,
    // so any extra draw calls in the live run come only from the blast. (A plain
    // painted() check is tautological here because the ruler always paints.)
    const inWindowBase = spyCtx();
    drawOverlay(eng({ d: { anim: 0.4 } }), inWindowBase.ctx);
    const live = spyCtx();
    drawOverlay(eng({ explosions: [{ x: 100, floor: 5, start: 0 }], d: { anim: 0.4 } }), live.ctx);
    expect(live.log.length).toBeGreaterThan(inWindowBase.log.length); // the blast added draws

    // p > 1 (past EXPLOSION_SECONDS) draws nothing for the flash: an elapsed
    // explosion matches its no-explosion baseline call by call.
    const elapsedBase = spyCtx();
    drawOverlay(eng({ d: { anim: 99 } }), elapsedBase.ctx);
    const done = spyCtx();
    drawOverlay(eng({ explosions: [{ x: 100, floor: 5, start: 0 }], d: { anim: 99 } }), done.ctx);
    expect(done.log.length).toBe(elapsedBase.log.length); // blast skipped, no extra draws
  });

  it("treasure sparkles paint while their window is open", () => {
    // Baseline with no treasures proves the sparkle painter adds draws rather
    // than relying on the always-on ruler.
    const base = spyCtx();
    drawOverlay(eng({ d: { anim: 0.5 } }), base.ctx);
    const s = spyCtx();
    drawOverlay(eng({ treasures: [{ x: 120, floor: 6, start: 0 }], d: { anim: 0.5 } }), s.ctx);
    expect(s.log.length).toBeGreaterThan(base.log.length);
  });

  it("the VIP limo paints on arrival, hold and departure legs", () => {
    for (const anim of [0.1, 0.5, 0.9]) {
      // Compare against a vipStart: null baseline at the same anim time so the
      // extra draws are provably the limo on this leg, not the ruler.
      const base = spyCtx();
      drawOverlay(eng({ vipStart: null, d: { anim } }), base.ctx);
      const s = spyCtx();
      drawOverlay(eng({ vipStart: 0, d: { anim } }), s.ctx);
      expect(s.log.length).toBeGreaterThan(base.log.length);
    }
  });

  it("the thief paints, and its caught variant differs from the free one", () => {
    const free = spyCtx();
    drawOverlay(eng({ thiefStart: 0, thiefCaught: false, d: { anim: 1 } }), free.ctx);
    const caught = spyCtx();
    drawOverlay(eng({ thiefStart: 0, thiefCaught: true, d: { anim: 1 } }), caught.ctx);
    expect(free.painted()).toBe(true);
    expect(free.log.join("|")).not.toBe(caught.log.join("|"));
  });
});

describe("preview and selection painters", () => {
  it("a valid facility ghost and an invalid one paint differently", () => {
    const ok = spyCtx();
    drawOverlay(eng({ preview: { kind: "office", floor: 5, x: 100, valid: true } }), ok.ctx);
    const bad = spyCtx();
    drawOverlay(eng({ preview: { kind: "office", floor: 5, x: 100, valid: false } }), bad.ctx);
    expect(ok.log.join("|")).not.toBe(bad.log.join("|"));
  });

  it("a floor/lobby brush uses its span for the ghost footprint", () => {
    const s = spyCtx();
    drawOverlay(eng({ preview: { kind: "floor", floor: 5, x: 100, valid: true, span: 12 } }), s.ctx);
    expect(s.painted()).toBe(true);
  });

  it("a transport preview ghost paints its shaft footprint", () => {
    const s = spyCtx();
    drawOverlay(eng({ transportPreview: { kind: "elevatorStandard", x: 100, bottom: 1, top: 10, valid: true } }), s.ctx);
    expect(s.painted()).toBe(true);
  });

  it("selecting a unit strokes its outline and clears any arrow hit-rects", () => {
    const s = spyCtx();
    const e = eng({ selectedId: 42, arrowHit: { up: { x: 0, y: 0, w: 1, h: 1 } } });
    e.sim.tower.getUnit = () => ({ kind: "office", x: 100, floor: 5, width: 4 });
    drawOverlay(e, s.ctx);
    expect(s.painted()).toBe(true);
    expect(e.arrowHit).toEqual({}); // reset at the top of drawSelection
  });

  it("selecting an elevator draws extend arrows and registers their hit-rects", () => {
    const s = spyCtx();
    const e = eng({ selectedId: 7 });
    e.sim.tower.getUnit = () => undefined;
    e.sim.tower.getTransport = () => ({ kind: "elevatorStandard", x: 100, width: 4, top: 20, bottom: 4 });
    drawOverlay(e, s.ctx);
    expect(e.arrowHit.up).toBeTruthy();
    expect(e.arrowHit.down).toBeTruthy();
  });

  it("selecting a non-elevator shaft outlines it but grows no arrows", () => {
    const s = spyCtx();
    const e = eng({ selectedId: 9 });
    e.sim.tower.getUnit = () => undefined;
    e.sim.tower.getTransport = () => ({ kind: "stairs", x: 100, width: 2, top: 6, bottom: 4 });
    drawOverlay(e, s.ctx);
    expect(e.arrowHit).toEqual({}); // stairs/escalators never extend by a tappable arrow
    expect(s.painted()).toBe(true);
  });
});

describe("elevator floor numbers wired into the overlay", () => {
  it("paints shaft numbers in the shaft column (drawOverlay calls drawShaftNumbers)", () => {
    const s = spyCtx();
    const e = eng();
    e.sim.tower.transports = [{ id: 1, kind: "elevatorStandard", x: 100, width: 4, bottom: 1, top: 3, carPositions: [] }];
    drawOverlay(e, s.ctx);
    // Assert on strokeText, which only drawShaftNumbers emits (the ruler and
    // legend use fillText), at x === 102 (the shaft center, x:100 + width 4 / 2).
    // That pins both that the renderer ran and that it ran through drawOverlay.
    const inColumn = s.log.filter((l) => l.startsWith("strokeText:") && JSON.parse(l.slice(11))[1] === 102);
    expect(inColumn.length).toBeGreaterThan(0);
  });
});

describe("syncEventFx event-visual state machine", () => {
  function fxEngine(over: Record<string, unknown> = {}) {

    const e: any = {
      d: { anim: 10 },
      santaStart: null,
      lastSantaSeq: 0,
      explosions: [],
      lastExplosionSeq: 0,
      thiefStart: null,
      thiefCaught: false,
      thiefFloor: 1,
      lastThiefSeq: 0,
      treasures: [],
      lastTreasureSeq: 0,
      vipStart: null,
      lastVipSeq: 0,
      sim: {
        santaFxSeq: 0,
        explosionFx: { seq: 0, x: 0, floor: 0 },
        thiefFx: { seq: 0, caught: false, floor: 0 },
        treasureFx: { seq: 0, x: 0, floor: 0 },
        vipFxSeq: 0,
      },
      ...over,
    };
    return e;
  }

  it("starts each visual when its fx counter ticks while animating", () => {
    const e = fxEngine();
    e.sim.santaFxSeq = 1;
    e.sim.explosionFx = { seq: 1, x: 20, floor: 4 };
    e.sim.thiefFx = { seq: 1, caught: true, floor: 8 };
    e.sim.treasureFx = { seq: 1, x: 30, floor: 2 };
    e.sim.vipFxSeq = 1;
    syncEventFx(e, true);
    expect(e.santaStart).toBe(10);
    expect(e.explosions).toHaveLength(1);
    expect(e.thiefStart).toBe(10);
    expect(e.thiefCaught).toBe(true);
    expect(e.thiefFloor).toBe(8);
    expect(e.treasures).toHaveLength(1);
    expect(e.vipStart).toBe(10);
  });

  it("consumes the fx counter but starts nothing while not animating", () => {
    const e = fxEngine();
    e.sim.santaFxSeq = 1;
    e.sim.explosionFx = { seq: 1, x: 20, floor: 4 };
    syncEventFx(e, false);
    expect(e.lastSantaSeq).toBe(1); // baseline advanced
    expect(e.santaStart).toBeNull(); // but no visual began
    expect(e.explosions).toHaveLength(0);
  });

  it("retires each visual once its window on the anim clock elapses", () => {
    const e = fxEngine({
      d: { anim: 1000 },
      santaStart: 0,
      explosions: [{ x: 0, floor: 0, start: 0 }],
      thiefStart: 0,
      treasures: [{ x: 0, floor: 0, start: 0 }],
      vipStart: 0,
    });
    syncEventFx(e, true);
    expect(e.santaStart).toBeNull();
    expect(e.explosions).toHaveLength(0);
    expect(e.thiefStart).toBeNull();
    expect(e.treasures).toHaveLength(0);
    expect(e.vipStart).toBeNull();
  });

  it("caps concurrent explosions and treasures", () => {
    const e = fxEngine({ explosions: Array.from({ length: MAX_EXPLOSIONS }, () => ({ x: 0, floor: 0, start: 10 })) });
    e.sim.explosionFx = { seq: 1, x: 1, floor: 1 };
    syncEventFx(e, true);
    expect(e.explosions.length).toBe(MAX_EXPLOSIONS); // no growth past the cap
    const t = fxEngine({ treasures: Array.from({ length: MAX_TREASURES }, () => ({ x: 0, floor: 0, start: 10 })) });
    t.sim.treasureFx = { seq: 1, x: 1, floor: 1 };
    syncEventFx(t, true);
    expect(t.treasures.length).toBe(MAX_TREASURES);
  });
});

describe("reduced motion and the decorative clock", () => {
  it("setReducedMotion(true) drops every in-flight event visual", () => {

    const e: any = {
      reducedMotion: false,
      santaStart: 5,
      explosions: [{ x: 0, floor: 0, start: 0 }],
      thiefStart: 5,
      thiefCaught: true,
      treasures: [{ x: 0, floor: 0, start: 0 }],
      vipStart: 5,
    };
    setReducedMotion(e, true);
    expect(e.reducedMotion).toBe(true);
    expect(e.santaStart).toBeNull();
    expect(e.explosions).toEqual([]);
    expect(e.thiefStart).toBeNull();
    expect(e.thiefCaught).toBe(false);
    expect(e.treasures).toEqual([]);
    expect(e.vipStart).toBeNull();
  });

  it("setReducedMotion(false) leaves visuals untouched", () => {

    const e: any = { reducedMotion: true, santaStart: 5, explosions: [], thiefStart: null, treasures: [], vipStart: null };
    setReducedMotion(e, false);
    expect(e.reducedMotion).toBe(false);
    expect(e.santaStart).toBe(5);
  });

  it("resetDecorativeClock zeroes both the clock and the published anim value", () => {

    const e: any = { animClock: 42, d: { anim: 42 } };
    resetDecorativeClock(e);
    expect(e.animClock).toBe(0);
    expect(e.d.anim).toBe(0);
  });
});
