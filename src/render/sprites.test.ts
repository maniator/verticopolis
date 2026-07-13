import { describe, it, expect } from "vitest";
import type { Unit, Transport } from "../engine/types";
import { FASTFOOD_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "../engine/retailSubtypes";
import {
  drawUnit,
  drawTransport,
  drawAwning,
  drawCar,
  drawCrane,
  drawEscapeStairs,
  drawLobbyEntrance,
  craneAnchorTile,
  lobbyVariant,
  LOBBY_VARIANTS,
  drawGarbageTruck,
  drawMetroTrain,
  drawStreetCar,
  type DrawCtx,
} from "./sprites";
import { shade, rand, ACCENTS } from "./sprites/common";
import { PAL, person, drawRoom, sampleState } from "./pixelSprites";
import { drawSanta, drawExplosion, drawThief, drawTreasure, drawVipLimo } from "./sprites/events";

/**
 * The procedural sprite layer draws every facility from shapes into a 2D
 * context. These tests drive the real draw code against a recording spy context
 * — proving each facility/state actually paints (no throw, non-trivial output)
 * and that the state-driven branches (recycling fill, dead parking, lit lobby)
 * produce a genuinely DIFFERENT drawing, not just "the function ran". Pixel
 * fidelity itself is the Playwright visual tier's job; this pins behavior + the
 * pure helpers.
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

describe("drawUnit — every facility/state paints without throwing", () => {
  const cases: Array<[string, Partial<Unit>]> = [
    ["floor", { kind: "floor" }],
    ["lobby", { kind: "lobby" }],
    ["under construction", { kind: "office", state: "construction" }],
    ["on fire", { kind: "office", state: "fire" }],
    ["gutted shell", { kind: "office", state: "gutted" }],
    ["occupied office", { kind: "office", state: "occupied" }],
    ["empty office (for-lease)", { kind: "office", state: "empty" }],
    ["condo", { kind: "condo" }],
    ["hotel single (asleep)", { kind: "hotelSingle", state: "asleep" }],
    ["hotel suite", { kind: "hotelSuite" }],
    ["fast food", { kind: "fastFood" }],
    ["restaurant", { kind: "restaurant" }],
    ["shop", { kind: "shop" }],
    ["cinema", { kind: "cinema" }],
    ["security", { kind: "security" }],
    ["medical", { kind: "medical" }],
    ["housekeeping", { kind: "housekeeping" }],
    ["party hall", { kind: "partyHall" }],
    ["metro", { kind: "metro" }],
    ["wedding hall", { kind: "weddingHall" }],
    ["parking space", { kind: "parking" }],
    ["parking ramp", { kind: "parkingRamp" }],
    ["recycling", { kind: "recycling" }],
  ];
  it.each(cases)("paints %s", (_label, over) => {
    const s = spyCtx();
    expect(() => drawUnit(draw({ recycleFill: 0.5, parkingUse: 0.5 }, s.ctx), unit(over), 10, 20, 60, 34)).not.toThrow();
    expect(s.painted()).toBe(true);
  });
});

describe("drawUnit — state actually changes the drawing (behavioral, not just 'ran')", () => {
  it("a recycling center draws differently as it fills up", () => {
    const empty = spyCtx();
    const full = spyCtx();
    drawUnit(draw({ recycleFill: 0 }, empty.ctx), unit({ kind: "recycling" }), 0, 0, 120, 68);
    drawUnit(draw({ recycleFill: 1 }, full.ctx), unit({ kind: "recycling" }), 0, 0, 120, 68);
    expect(full.sig()).not.toBe(empty.sig());
  });

  it("a dead parking space draws differently from a live one", () => {
    const live = spyCtx();
    const dead = spyCtx();
    drawUnit(draw({ parkingUse: 1, parkingDead: false }, live.ctx), unit({ kind: "parking" }), 0, 0, 60, 34);
    drawUnit(draw({ parkingUse: 1, parkingDead: true }, dead.ctx), unit({ kind: "parking" }), 0, 0, 60, 34);
    expect(dead.sig()).not.toBe(live.sig());
  });

  it("lobby columns with different variants draw differently", () => {
    // Find two columns whose lobbyVariant differs, then prove the drawing does too.
    const xa = 0;
    let xb = 1;
    while (lobbyVariant(xb) === lobbyVariant(xa) && xb < 60) xb++;
    expect(lobbyVariant(xa)).not.toBe(lobbyVariant(xb)); // guard: found a differing pair
    const a = spyCtx();
    const b = spyCtx();
    drawUnit(draw({}, a.ctx), unit({ kind: "lobby", x: xa }), 0, 0, 60, 34);
    drawUnit(draw({}, b.ctx), unit({ kind: "lobby", x: xb }), 0, 0, 60, 34);
    expect(b.sig()).not.toBe(a.sig());
  });
});

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

  it("the standard cab keeps its established frame, interior, and light-strip colors", () => {
    const s = spyCtx();
    drawCar(s.ctx, 1, 44, 44, 0);
    expect(s.log).toContain("fillStyle=#8e94a0");
    expect(s.log).toContain("fillStyle=#d8dce2");
    expect(s.log).toContain("fillStyle=#f3f6fa");
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

describe("pixel-art room module", () => {
  it("person paints a figure (seated and standing, with and without a tint)", () => {
    for (const [seated, tint] of [[false, undefined], [true, "#ff0000"]] as const) {
      const s = spyCtx();
      expect(() => person(s.ctx, 10, 30, 2, 7, seated, tint)).not.toThrow();
      expect(s.painted()).toBe(true);
    }
  });

  it("drawRoom paints leased and vacant rooms differently", () => {
    const occupied = spyCtx();
    const empty = spyCtx();
    const room = { ctx: occupied.ctx, lit: true, anim: 0, hour: 12 };
    drawRoom(room, unit({ kind: "office", state: "occupied", occupants: 4 }), 0, 0, 60, 34);
    drawRoom({ ...room, ctx: empty.ctx }, unit({ kind: "office", state: "empty", occupants: 0 }), 0, 0, 60, 34);
    expect(occupied.painted()).toBe(true);
    expect(empty.sig()).not.toBe(occupied.sig()); // vacant draws a "for lease" treatment
  });

  it("sampleState returns a valid preview state for a kind", () => {
    expect(sampleState("office")).toBe("occupied");
    expect(sampleState("hotelSuite")).toBe("occupied");
  });

  it("PAL is a non-empty palette of color strings", () => {
    const vals = Object.values(PAL);
    expect(vals.length).toBeGreaterThan(0);
  });
});

describe("pure sprite helpers", () => {
  it("shade lightens on a positive delta and darkens on a negative one", () => {
    const lighter = shade("#808080", 40); // amt is added per 0–255 channel
    const darker = shade("#808080", -40);
    expect(lighter).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    const chan = (s: string) => Number(s.match(/\d+/)![0]);
    expect(chan(lighter)).toBeGreaterThan(128);
    expect(chan(darker)).toBeLessThan(128);
    expect(chan(shade("#ffffff", 999))).toBe(255); // clamps at the ceiling
  });

  it("rand is deterministic and bounded to [0, 1)", () => {
    expect(rand(42)).toBe(rand(42));
    for (const seed of [0, 1, 999, 123456]) {
      const v = rand(seed);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("lobbyVariant is deterministic and within LOBBY_VARIANTS", () => {
    for (let x = 0; x < 50; x++) {
      const v = lobbyVariant(x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(LOBBY_VARIANTS);
      expect(v).toBe(lobbyVariant(x)); // stable per column
    }
  });

  it("craneAnchorTile anchors over the center of the LONGEST contiguous run", () => {
    // Runs: [10,11,12] (len 3) and [20,21] (len 2) → the longest wins, centered
    // at 11.5. Pinning the value guards the "longest run" contract (a bug that
    // picked the trailing run would land 20.5, not just "somewhere in span").
    expect(craneAnchorTile([10, 11, 12, 20, 21])).toBe(11.5);
  });

  it("ACCENTS is a palette of hex colors", () => {
    expect(ACCENTS.length).toBeGreaterThan(0);
    for (const c of ACCENTS) expect(c).toMatch(/^#[0-9a-f]{3,8}$/i);
  });
});

describe("retail subtype looks paint distinctly (drawRoom)", () => {
  // Draw each canon variant through the REAL drawRoom path at an open hour and
  // compare full paint logs: the variety system's contract is that every
  // variant of a kind paints differently (colors or geometry), while the kind
  // anchor shape survives. Also exercises every fixture and interior branch
  // so the coverage gate keeps guarding this file.
  const cases: Array<[Unit["kind"], readonly string[], number]> = [
    ["fastFood", FASTFOOD_SUBTYPES, 12],
    ["restaurant", RESTAURANT_SUBTYPES, 19],
    ["shop", SHOP_SUBTYPES, 14],
  ];
  for (const [kind, names, hour] of cases) {
    it(`${kind}: every canon variant paints, and no two variants paint identically`, () => {
      const sigs = new Map<string, string>();
      for (const name of names) {
        const s = spyCtx();
        // Width comfortably past the emblem gate (w > 40) so signature props draw.
        drawRoom(draw({ hour, lit: false }, s.ctx), unit({ kind, subtype: name, occupants: 5 }), 0, 0, 144, 26);
        expect(s.painted(), `${kind} "${name}" painted nothing`).toBe(true);
        for (const [other, sig] of sigs) {
          expect(s.sig(), `${kind} "${name}" paints identically to "${other}"`).not.toBe(sig);
        }
        sigs.set(name, s.sig());
      }
    });

    it(`${kind}: an undefined subtype still paints (legacy fallback)`, () => {
      const s = spyCtx();
      drawRoom(draw({ hour, lit: false }, s.ctx), unit({ kind, occupants: 5 }), 0, 0, 144, 26);
      expect(s.painted()).toBe(true);
    });
  }

  it("an unknown (non-canon) subtype falls back to the default look, not a crash", () => {
    for (const [kind, , hour] of cases) {
      const withUnknown = spyCtx();
      drawRoom(draw({ hour, lit: false }, withUnknown.ctx), unit({ kind, subtype: "Not A Real Variety", occupants: 5 }), 0, 0, 144, 26);
      const withNone = spyCtx();
      drawRoom(draw({ hour, lit: false }, withNone.ctx), unit({ kind, occupants: 5 }), 0, 0, 144, 26);
      expect(withUnknown.sig()).toBe(withNone.sig());
    }
  });
});

describe("per-unit geo-seeded variety (party law: geometry first)", () => {
  const at = (kind: Unit["kind"], floor: number, ux: number, over: Partial<Unit> = {}): Unit =>
    unit({ kind, floor, x: ux, occupants: 4, ...over });

  it("the same room paints identically twice (pure geo seed, no RNG)", () => {
    for (const kind of ["office", "condo", "hotelDouble"] as const) {
      const a = spyCtx();
      const b = spyCtx();
      drawRoom(draw({ hour: 12 }, a.ctx), at(kind, 10, 30), 0, 0, 144, 26);
      drawRoom(draw({ hour: 12 }, b.ctx), at(kind, 10, 30), 0, 0, 144, 26);
      expect(b.sig()).toBe(a.sig());
    }
  });

  it("offices and condos vary across positions (layouts, mirroring, walls)", () => {
    for (const kind of ["office", "condo"] as const) {
      const sigs = new Set<string>();
      for (let ux = 0; ux < 120; ux += 12) {
        const s = spyCtx();
        drawRoom(draw({ hour: 12 }, s.ctx), at(kind, 10, ux), 0, 0, 144, 26);
        sigs.add(s.sig());
      }
      // A sweep across one floor must produce several distinct paints; exact
      // count is seed-dependent, but a cloned row is the regression.
      expect(sigs.size, `${kind} row paints as clones`).toBeGreaterThan(2);
    }
  });

  it("hotel state cues survive every variant (asleep z, dirty tray, ready lamp)", () => {
    for (let ux = 0; ux < 48; ux += 8) {
      const asleep = spyCtx();
      drawRoom(draw({ hour: 1, lit: false }, asleep.ctx), at("hotelDouble", 12, ux, { state: "asleep", occupants: 2 }), 0, 0, 144, 26);
      expect(asleep.log.some((l) => l.startsWith("fillText"))).toBe(true); // the z
      const dirty = spyCtx();
      drawRoom(draw({ hour: 10 }, dirty.ctx), at("hotelDouble", 12, ux, { state: "dirty", occupants: 0 }), 0, 0, 144, 26);
      expect(dirty.log.some((l) => l.includes("#D4623A"))).toBe(true); // the tray
      const ready = spyCtx();
      drawRoom(draw({ hour: 20, lit: true }, ready.ctx), at("hotelDouble", 12, ux, { state: "empty", occupants: 0 }), 0, 0, 144, 26);
      expect(ready.log.some((l) => l.includes("#FFD86A"))).toBe(true); // the lamp
    }
  });
});
