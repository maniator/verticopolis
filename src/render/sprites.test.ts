import { describe, it, expect } from "vitest";
import type { Unit } from "../engine/types";
import { AMUSEMENTS_SUBTYPES, FASTFOOD_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "../engine/retailSubtypes";
import {
  drawUnit,
  craneAnchorTile,
  lobbyVariant,
  LOBBY_VARIANTS,
  type DrawCtx,
} from "./sprites";
import { shade, rand, ACCENTS } from "./sprites/common";
import { SKIN } from "./pixelSprites/common";
import { PAL, person, drawRoom, sampleState } from "./pixelSprites";

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
    ["food hall", { kind: "foodHall" }],
    ["amusements", { kind: "amusements" }],
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

  it("a party hall gates its figures on hall occupancy (two-floor 88px rect)", () => {
    const empty = spyCtx();
    const full = spyCtx();
    // The catalog gives the party hall two floors (88px). Occupancy drives the
    // dancers, DJ, and banquet guests; an empty hall draws none, a full one does.
    drawUnit(draw({}, empty.ctx), unit({ kind: "partyHall", occupants: 0 }), 0, 0, 264, 88);
    drawUnit(draw({}, full.ctx), unit({ kind: "partyHall", occupants: 8 }), 0, 0, 264, 88);
    // A person build lays a 1px contact shadow at rgba(0,0,0,0.24): its presence
    // marks a drawn occupant. The shell/windows/fixtures paint either way.
    const occupant = "fillStyle=rgba(0,0,0,0.24)";
    expect(empty.log).not.toContain(occupant);
    expect(full.log).toContain(occupant);
    expect(empty.log.some((l) => l.startsWith("fillRect"))).toBe(true);
  });

  it("a cinema paints green EXIT signage on its two-floor rect without throwing", () => {
    const s = spyCtx();
    // A cinema is open at hour 20 (the default), so the auditorium draws rather
    // than the closed shutter; EXIT green #6bd47a is a non-reserved canon color.
    expect(() => drawUnit(draw({}, s.ctx), unit({ kind: "cinema" }), 0, 0, 341, 88)).not.toThrow();
    expect(s.log).toContain("fillStyle=#6bd47a");
  });

  it("each Amusements attraction draws its own distinct room", () => {
    // Four attractions, four interiors: the same guarantee the distinctness
    // test pins on the look table must show up in the actual drawing.
    const sigs = new Set<string>();
    for (const name of AMUSEMENTS_SUBTYPES) {
      const s = spyCtx();
      expect(() => drawUnit(draw({}, s.ctx), unit({ kind: "amusements", subtype: name, occupants: 3 }), 0, 0, 132, 44)).not.toThrow();
      expect(s.painted()).toBe(true);
      sigs.add(s.sig());
    }
    expect(sigs.size, "two attractions drew identically").toBe(AMUSEMENTS_SUBTYPES.length);
  });

  it("every Amusements attraction reads empty when empty and full when full", () => {
    // The room draws either way (cabinets, pods, machines, turf), but the people
    // (person builds, 1px contact shadow) appear ONLY when occupied. Checked for
    // ALL four attractions: VR and mini-golf used to draw a lone figure even at
    // zero occupancy, contradicting the "empty hall reads empty" invariant.
    const occupant = "fillStyle=rgba(0,0,0,0.24)";
    for (const name of AMUSEMENTS_SUBTYPES) {
      const empty = spyCtx();
      const full = spyCtx();
      drawUnit(draw({}, empty.ctx), unit({ kind: "amusements", subtype: name, occupants: 0 }), 0, 0, 132, 44);
      drawUnit(draw({}, full.ctx), unit({ kind: "amusements", subtype: name, occupants: 6 }), 0, 0, 132, 44);
      expect(empty.log, `${name} drew a person while empty`).not.toContain(occupant);
      expect(full.log, `${name} drew no person while full`).toContain(occupant);
    }
  });

  it("an Amusements hall can't be hung by a forged occupant count", () => {
    // The mini-golf watcher loop is bounded by the bay width, not the raw
    // occupant count, so a corrupt save with a huge `occupants` paints a bounded
    // number of figures and returns instead of spinning.
    const s = spyCtx();
    expect(() => drawUnit(draw({}, s.ctx), unit({ kind: "amusements", subtype: "Mini Golf", occupants: 1e9 }), 0, 0, 132, 44)).not.toThrow();
    // A 132px bay fits only a handful of watchers; nowhere near a billion.
    const people = s.log.filter((l) => l === "fillStyle=rgba(0,0,0,0.24)").length;
    expect(people).toBeLessThan(20);
  });
});

describe("service facilities — reserved colors, integer pixels, and state cues", () => {
  // Reserved state colors must never appear as decoration, every rectangle must
  // land on integer coordinates, and the recycling FULL gauge is a state cue.
  const RESERVED = ["#C24A3A", "#C9CCC4", "#B2B0A4", "#E8A030", "#D4623A", "#FFD86A", "#E0556B"];
  const KINDS: Array<Partial<Unit>> = (["security", "medical", "housekeeping", "recycling", "metro", "parking", "parkingRamp"] as const).map((kind) => ({ kind }));

  it("no reserved decoration color, integer pixels only, across fill/lit/dead states", () => {
    for (const over of KINDS) {
      for (const [rf, pd, lit] of [[0, false, true], [0.8, false, false], [1, false, true], [0.5, true, true]] as const) {
        const s = spyCtx();
        drawUnit(draw({ recycleFill: rf, parkingUse: 1, parkingDead: pd, lit }, s.ctx), unit(over), 0, 0, 176, 88);
        const fills = s.log.filter((x) => x.startsWith("fillStyle=")).map((x) => x.slice("fillStyle=".length).toLowerCase());
        for (const r of RESERVED) expect(fills, `${String(over.kind)} painted reserved ${r}`).not.toContain(r.toLowerCase());
        for (const l of s.log.filter((x) => x.startsWith("fillRect:")))
          for (const n of JSON.parse(l.slice("fillRect:".length)) as number[]) expect(Number.isInteger(n), `${String(over.kind)} non-integer ${l}`).toBe(true);
      }
    }
  });

  it("recycling reads green, then amber past 0.7, then red with the FULL label at capacity", () => {
    const at = (rf: number) => {
      const s = spyCtx();
      drawUnit(draw({ recycleFill: rf }, s.ctx), unit({ kind: "recycling" }), 0, 0, 220, 88);
      return s;
    };
    const amber = at(0.85);
    expect(amber.log).toContain("fillStyle=#e0a94e");
    expect(amber.log).not.toContain("fillStyle=#d6342f");
    const full = at(1);
    expect(full.log).toContain("fillStyle=#d6342f"); // FULL-state red gauge
    expect(full.log.some((l) => l.startsWith("fillText:") && l.includes("FULL"))).toBe(true);
  });

  it("the metro platform draws empty — no baked crowd, legacy or finalized (no ghost people)", () => {
    // scatterPeople paints via legacy person(), whose hair overlay is a unique
    // literal; its absence proves no legacy crowd rides the station. The skin
    // tones prove the point for the finalized person() family too: a station
    // that bakes no figure of either idiom paints no skin, so an empty tower
    // reads empty and the real commuters ride the traffic overlay instead.
    const s = spyCtx();
    drawUnit(draw({}, s.ctx), unit({ kind: "metro" }), 0, 0, 330, 132);
    expect(s.log).not.toContain("fillStyle=rgba(30,24,20,0.65)");
    for (const skin of SKIN) expect(s.log, `metro baked a figure (skin ${skin})`).not.toContain(`fillStyle=${skin}`);
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
