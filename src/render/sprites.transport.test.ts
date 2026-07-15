import { describe, it, expect } from "vitest";
import type { Unit, Transport } from "../engine/types";
import {
  drawUnit,
  drawTransport,
  drawAwning,
  drawCar,
  drawCrane,
  drawEscapeStairs,
  drawLobbyEntrance,
  drawGarbageTruck,
  drawMetroTrain,
  drawStreetCar,
  type DrawCtx,
} from "./sprites";
import { RESERVED_COLORS } from "./pixelSprites/common";
import { drawSanta, drawExplosion, drawThief, drawTreasure, drawVipLimo } from "./sprites/events";

/**
 * Transport, crane, moving-vehicle, and event sprite coverage split out of
 * sprites.test.ts to keep each file under the size ceiling. These tests drive
 * the real draw code against a recording spy context, proving each sprite/state
 * actually paints and that state-driven branches produce a genuinely different
 * drawing.
 */

/** A recording 2D-context stand-in: every method and style assignment is logged,
 *  so two drawings can be compared for a real difference (colors AND geometry). */
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
    sig: () => log.join("|"),
    painted: () => log.some((l) => l.startsWith("fillRect") || l.startsWith("fill:") || l.startsWith("stroke:") || l.startsWith("fillText")),
  };
}

function unit(over: Partial<Unit> = {}): Unit {
  return { id: 1, kind: "office", floor: 3, x: 5, width: 8, state: "occupied", satisfaction: 1, occupants: 2, ...over } as Unit;
}
function draw(over: Partial<DrawCtx>, ctx: CanvasRenderingContext2D): DrawCtx {
  return { ctx, lit: true, anim: 0.5, hour: 20, ...over };
}

describe("transport, crane & event sprites paint", () => {
  function transport(over: Partial<Transport> = {}): Transport {
    return { id: 1, kind: "elevatorStandard", x: 5, width: 2, bottom: 1, top: 6, cars: 2, carPositions: [1, 4], carDir: [1, -1], carLoad: [3, 0], load: 3, ...over } as Transport;
  }

  it("drawTransport paints a shaft, honoring skip floors", () => {
    const s = spyCtx();
    expect(() => drawTransport(s.ctx, transport({ skipFloors: [3, 4] }), 10, 0, 24, 34)).not.toThrow();
    expect(s.painted()).toBe(true);
  });

  it("drawCar paints a cab; a full car with an up arrow differs from an empty idle one", () => {
    const idle = spyCtx();
    const busy = spyCtx();
    drawCar(idle.ctx, 1, 24, 34, 0, null, false);
    drawCar(busy.ctx, 1, 24, 34, 8, "up", true);
    expect(idle.painted()).toBe(true);
    expect(busy.sig()).not.toBe(idle.sig());
  });

  it("each elevator kind draws its own cab: standard, service, and express differ pairwise", () => {
    const std = spyCtx();
    const svc = spyCtx();
    const exp2 = spyCtx();
    drawCar(std.ctx, 1, 44, 44, 2, "up", false, "elevatorStandard");
    drawCar(svc.ctx, 1, 44, 44, 2, "up", false, "elevatorService");
    drawCar(exp2.ctx, 1, 44, 44, 2, "up", false, "elevatorExpress");
    expect(svc.sig()).not.toBe(std.sig());
    expect(exp2.sig()).not.toBe(std.sig());
    expect(exp2.sig()).not.toBe(svc.sig());
  });

  it("omitting the kind draws the standard cab, so existing call sites are unchanged", () => {
    const implicit = spyCtx();
    const explicit = spyCtx();
    drawCar(implicit.ctx, 1, 44, 44, 3, "down", false);
    drawCar(explicit.ctx, 1, 44, 44, 3, "down", false, "elevatorStandard");
    expect(explicit.sig()).toBe(implicit.sig());
  });

  it("the standard cab keeps its established warm brass-and-walnut colors", () => {
    const s = spyCtx();
    drawCar(s.ctx, 1, 44, 44, 0);
    expect(s.log).toContain("fillStyle=#4A4238"); // dark cab frame
    expect(s.log).toContain("fillStyle=#6B4A2B"); // walnut interior
    expect(s.log).toContain("fillStyle=#C9A24B"); // brass ceiling rail
    expect(s.log).toContain("fillStyle=#F8E2B4"); // warm ceiling glow dot
  });

  it("FULL and the direction lantern still change every kind's cab", () => {
    // Riders held constant so only the top-edge indicators can make the
    // difference; a kind branch that swallowed them would fail this.
    for (const kind of ["elevatorStandard", "elevatorService", "elevatorExpress"] as const) {
      const idle = spyCtx();
      const busy = spyCtx();
      drawCar(idle.ctx, 1, 44, 44, 0, null, false, kind);
      drawCar(busy.ctx, 1, 44, 44, 0, "up", true, kind);
      expect(busy.sig()).not.toBe(idle.sig());
    }
  });

  it("stairs and escalator each draw one flight rising to a second-floor landing", () => {
    // A two-floor stairway/escalator draws exactly one flight (the top band is
    // the arrival landing) and the two kinds render as different sprites. The
    // sprite bakes no rider; climbers are separate engine-driven actors.
    const stair = spyCtx();
    const esc = spyCtx();
    drawTransport(stair.ctx, transport({ kind: "stairs", bottom: 1, top: 2, width: 8 }), 0, 0, 88, 44);
    drawTransport(esc.ctx, transport({ kind: "escalator", bottom: 1, top: 2, width: 8 }), 0, 0, 88, 44);
    expect(stair.painted()).toBe(true);
    expect(esc.painted()).toBe(true);
    // Warm tan treads vs metallic steps: the two transport kinds are distinct.
    expect(stair.sig()).not.toBe(esc.sig());
    // The stairs paint their warm-tan tread color; the routed climbers that ride
    // the flight are engine-driven actors, not baked into this static sprite.
    expect(stair.log.some((l) => l.includes("#EDE6D2"))).toBe(true);
  });

  it("the wedding hall paints its two-floor composition into the full rect", () => {
    // Floor 100's venue draws into whatever w x h rect the caller gives; drive
    // it at the two-floor (88px) height to prove the arch, aisle, and couple
    // scale into a taller rect without throwing.
    const s = spyCtx();
    expect(() => drawUnit(draw({}, s.ctx), unit({ kind: "weddingHall" }), 0, 0, 176, 88)).not.toThrow();
    expect(s.painted()).toBe(true);
    // The couple: a dark-suited seated figure at the altar.
    expect(s.log.some((l) => l.includes("#2A2E38"))).toBe(true);
    // The white aisle runner the couple walks down (spec calls for white, not
    // a red carpet).
    expect(s.log.some((l) => l.includes("#F4F0EC"))).toBe(true);
  });

  it("drawEscapeStairs, drawCrane, and the moving-vehicle sprites all paint", () => {
    for (const run of [
      (c: CanvasRenderingContext2D) => drawEscapeStairs(c, "left", 0, 34),
      (c: CanvasRenderingContext2D) => drawEscapeStairs(c, "right", 1, 34),
      (c: CanvasRenderingContext2D) => drawAwning(c, "left", 34),
      (c: CanvasRenderingContext2D) => drawAwning(c, "right", 34),
      (c: CanvasRenderingContext2D) => drawCrane(c, 12, true),
      (c: CanvasRenderingContext2D) => drawGarbageTruck(c, 80),
      (c: CanvasRenderingContext2D) => drawMetroTrain(c, 120, true),
      (c: CanvasRenderingContext2D) => drawStreetCar(c, 3),
    ]) {
      const s = spyCtx();
      expect(() => run(s.ctx)).not.toThrow();
      expect(s.painted()).toBe(true);
    }
  });

  it("the ground-floor awning mirrors per side and differs from the escape stairs", () => {
    const awnL = spyCtx();
    const awnR = spyCtx();
    const esc = spyCtx();
    drawAwning(awnL.ctx, "left", 34);
    drawAwning(awnR.ctx, "right", 34);
    drawEscapeStairs(esc.ctx, "left", 0, 34);
    // Left and right canopies are mirror images, so their draw traces differ.
    expect(awnL.sig()).not.toBe(awnR.sig());
    // The awning is a distinct sprite from the fire escape it stands in for.
    expect(awnL.sig()).not.toBe(esc.sig());
  });

  it("the grand and service entrance tiles differ from each other and from normal lobby variants", () => {
    const bake = (fn: (c: CanvasRenderingContext2D) => void) => {
      const s = spyCtx();
      fn(s.ctx);
      return s;
    };
    const ctx = (lit: boolean, anim: number): DrawCtx => ({ ctx: null as unknown as CanvasRenderingContext2D, lit, anim, hour: lit ? 20 : 12 });
    const grand = bake((c) => drawLobbyEntrance({ ...ctx(true, 0), ctx: c }, "grand-right", 0, 0, 11, 34));
    const grandLeft = bake((c) => drawLobbyEntrance({ ...ctx(true, 0), ctx: c }, "grand-left", 0, 0, 11, 34));
    const grandSolo = bake((c) => drawLobbyEntrance({ ...ctx(true, 0), ctx: c }, "grand-solo", 0, 0, 11, 34));
    const service = bake((c) => drawLobbyEntrance({ ...ctx(true, 0), ctx: c }, "service", 0, 0, 11, 34));
    const grandDay = bake((c) => drawLobbyEntrance({ ...ctx(false, 0), ctx: c }, "grand-right", 0, 0, 11, 34));
    // Draw a normal variant-0 lobby tile via drawUnit for comparison.
    const lobbyUnit: Unit = {
      id: -1, kind: "lobby", floor: 1, x: 0, width: 1, state: "occupied",
      satisfaction: 1, occupants: 0, everOccupied: false, pendingIncome: 0, label: "",
    };
    const normal = bake((c) => drawUnit({ ...ctx(true, 0), ctx: c }, lobbyUnit, 0, 0, 11, 34));
    // Both entrance tiles paint, and they don't collapse to the same sprite.
    expect(grand.painted()).toBe(true);
    expect(grandLeft.painted()).toBe(true);
    expect(grandSolo.painted()).toBe(true);
    expect(service.painted()).toBe(true);
    expect(grand.sig()).not.toBe(service.sig());
    // The two slices of the wide storefront are different halves of the same
    // facade; they must not collapse to the same sprite.
    expect(grand.sig()).not.toBe(grandLeft.sig());
    // The compact 1-tile fallback is its own recipe; must not collapse into
    // either slice of the wide storefront.
    expect(grandSolo.sig()).not.toBe(grand.sig());
    expect(grandSolo.sig()).not.toBe(grandLeft.sig());
    // Neither entrance duplicates the plain lobby variant.
    expect(grand.sig()).not.toBe(normal.sig());
    expect(service.sig()).not.toBe(normal.sig());
    // The grand tile brightens at night, so day and night must differ.
    expect(grand.sig()).not.toBe(grandDay.sig());
  });

  it("the grand entrance doorman sway advances with d.anim", () => {
    const bake = (anim: number) => {
      const s = spyCtx();
      drawLobbyEntrance({ ctx: s.ctx, lit: true, anim, hour: 20 }, "grand-right", 0, 0, 11, 34);
      return s;
    };
    // Two frames of the 3-second cycle land at t=0 and t=1.6 (each frame is
    // 1.5s wide, so anywhere in [0,1.5) is frame A and [1.5, 3.0) is frame B).
    expect(bake(0).sig()).not.toBe(bake(1.6).sig());
  });

  it("the enriched vehicle sprites issue their signature fills (badge, livery, headlight)", () => {
    const truck = spyCtx();
    drawGarbageTruck(truck.ctx, 80);
    expect(truck.log).toContain("fillStyle=#DCE8C0"); // recycle-arrow badge
    expect(truck.log).toContain("fillStyle=#4A7A44"); // green hopper
    expect(truck.log).toContain("fillStyle=#16181C"); // wheel tire
    expect(truck.log).toContain("fillStyle=#5A5E66"); // wheel hub (two-tone)
    expect(truck.log.some((l) => l.startsWith("arc"))).toBe(false); // wheels are integer rects, not arcs

    const on = spyCtx();
    drawMetroTrain(on.ctx, 120, true);
    expect(on.log).toContain("fillStyle=#D0392B"); // red livery
    expect(on.log).toContain("fillStyle=#FFE27A"); // headlight lit
    const off = spyCtx();
    drawMetroTrain(off.ctx, 120, false);
    expect(off.log).not.toContain("fillStyle=#FFE27A"); // no lit headlight in the off state
    // The window glint also paints #9FC0E0, so a wide-carriage color check would
    // pass regardless of the headlight branch. Draw a narrow carriage where the
    // consist loop paints no car (a sub-24px remainder is skipped) and so no
    // glints, isolating the dark headlight.
    const offNarrow = spyCtx();
    drawMetroTrain(offNarrow.ctx, 8, false);
    expect(offNarrow.log).toContain("fillStyle=#9FC0E0"); // dark headlight, isolated from any glint
    expect(offNarrow.log).not.toContain("fillStyle=#FFE27A");

    const car = spyCtx();
    drawStreetCar(car.ctx, 3);
    expect(car.log).toContain("fillStyle=#CFE4FF"); // windows
    expect(car.log).toContain("fillStyle=#FFE27A"); // headlight
    expect(car.log.some((l) => /^fillStyle=rgb\(/.test(l))).toBe(true); // blue-anchored jittered body
  });

  it("no enriched actor or event sprite reuses a reserved state color for decoration", () => {
    const runs: Array<(c: CanvasRenderingContext2D) => void> = [
      (c) => drawGarbageTruck(c, 80),
      (c) => drawMetroTrain(c, 120, true),
      (c) => drawMetroTrain(c, 120, false),
      (c) => drawStreetCar(c, 3),
      (c) => drawStreetCar(c, 7),
      (c) => drawThief(c, 40, 40, 1, false),
      (c) => drawThief(c, 40, 40, 1, true),
      (c) => drawSanta(c, 40, 40, 1.15),
    ];
    for (const run of runs) {
      const s = spyCtx();
      run(s.ctx);
      const sig = s.log.join("|").toUpperCase();
      for (const reserved of RESERVED_COLORS) {
        expect(sig, `reserved literal ${reserved} appeared in an enriched sprite`).not.toContain(reserved.toUpperCase());
      }
    }
  });

  it("event sprites (santa, explosion, thief, treasure, limo) all paint", () => {
    for (const run of [
      (c: CanvasRenderingContext2D) => drawSanta(c, 10, 10, 1),
      (c: CanvasRenderingContext2D) => drawExplosion(c, 10, 10, 20, 0.5),
      (c: CanvasRenderingContext2D) => drawThief(c, 10, 10, 1, false),
      (c: CanvasRenderingContext2D) => drawThief(c, 10, 10, 1, true),
      (c: CanvasRenderingContext2D) => drawTreasure(c, 10, 10, 1, 0.5),
      (c: CanvasRenderingContext2D) => drawVipLimo(c, 10, 10, 1),
    ]) {
      const s = spyCtx();
      expect(() => run(s.ctx)).not.toThrow();
      expect(s.painted()).toBe(true);
    }
  });
});
