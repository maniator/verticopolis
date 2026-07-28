import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Unit } from "../engine/types";
import { SHOP_SUBTYPES } from "../engine/retailSubtypes";
import { drawUnit, drawLobbyEntrance, type EntranceKind, type DrawCtx } from "./sprites";

/**
 * "An empty tower reads empty": the people-system canon that no figure paints
 * unless a real person is there (`spec-pixelart-people-system.md`, the Never
 * rule "No ghost people"). These pin the room and entrance figures that used to
 * paint unconditionally, so a regression that reintroduces a seeded or constant
 * crowd fails here rather than in a player's screenshot (#552, #639).
 *
 * The sibling `sprites.test.ts` covers "every facility paints"; this file is
 * only about WHO paints and when.
 */

/** A recording 2D-context stand-in: enough of the surface for the draw code,
 *  logging every call and style assignment so a figure's presence is provable. */
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
  return { ctx: ctx as CanvasRenderingContext2D, log };
}

function unit(over: Partial<Unit> = {}): Unit {
  return { id: 1, kind: "office", floor: 3, x: 5, width: 8, state: "occupied", satisfaction: 1, occupants: 2, ...over } as Unit;
}
function draw(over: Partial<DrawCtx>, ctx: CanvasRenderingContext2D): DrawCtx {
  return { ctx, lit: true, anim: 0.5, hour: 20, ...over };
}

/** A person build lays a 1px contact shadow at this exact alpha, so the fill
 *  style's presence in the log marks a drawn figure. Shells, furniture and
 *  fixtures paint either way, which is what makes this a figure-only probe. */
const FIGURE = "fillStyle=rgba(0,0,0,0.24)";

describe("venue figures are gated on real occupancy (#552)", () => {
  // The wedding hall used to take no Unit at all, so it painted the couple and
  // two full rows of guests into every hall, tenanted or not.
  it("a wedding hall with no attendees draws its chairs but nobody in them", () => {
    const s = spyCtx();
    drawUnit(draw({}, s.ctx), unit({ kind: "weddingHall", occupants: 0 }), 0, 0, 176, 88);
    expect(s.log).not.toContain(FIGURE);
    // The room itself still paints: this is an empty hall, not a blank rect.
    expect(s.log.some((l) => l.startsWith("fillRect"))).toBe(true);
  });

  it("a wedding hall seats more guests as attendance rises", () => {
    // Counting, not just presence: asserting one figure exists would be
    // satisfied by the groom alone, who always draws first, so both guest rows
    // could stop gating (or stop drawing) with the test still green.
    const seated = (occupants: number) => {
      const s = spyCtx();
      drawUnit(draw({}, s.ctx), unit({ kind: "weddingHall", occupants }), 0, 0, 176, 88);
      return s.log.filter((l) => l === FIGURE).length;
    };
    expect(seated(8)).toBeGreaterThan(seated(2));
    expect(seated(2)).toBeGreaterThan(seated(0));
    expect(seated(0)).toBe(0);
  });

  it("seats the couple before the guest rows, so one attendee reads as a wedding", () => {
    // The bride is a hand-drawn gowned figure (her gown fill, not a person
    // build), so a two-attendee hall shows the groom's build plus the gown and
    // no seated guests. This pins the fill ORDER, which is what makes a small
    // wedding legible instead of looking like a lone stranger in an empty hall.
    const couple = spyCtx();
    drawUnit(draw({}, couple.ctx), unit({ kind: "weddingHall", occupants: 2 }), 0, 0, 176, 88);
    const figures = couple.log.filter((l) => l === FIGURE).length;
    expect(figures).toBe(1); // the groom; the bride is drawn as a gown
    expect(couple.log).toContain("fillStyle=#F0F0F0"); // her veil: she was seated
  });

  it("an aquatic center with no swimmers draws an empty pool", () => {
    const s = spyCtx();
    drawUnit(draw({}, s.ctx), unit({ kind: "aquaticCenter", occupants: 0 }), 0, 0, 224, 88);
    expect(s.log).not.toContain(FIGURE);
  });

  // The plain shop paints its shopper with the LEGACY person() build, which
  // lays no contact shadow; its hair overlay is a unique literal, so that is the
  // probe here (the same one the metro platform's empty-crowd test uses).
  const LEGACY_FIGURE = "fillStyle=rgba(30,24,20,0.65)";

  /** How many person figures a shop of this subtype/id/occupancy paints. Staff
   *  (the florist, the bank tellers, the post office clerk) draw unconditionally
   *  and are not ghosts; only the browsing customer is occupancy-gated. */
  const shopFigures = (subtype: string, id: number, occupants: number) => {
    const s = spyCtx();
    drawUnit(draw({}, s.ctx), unit({ id, kind: "shop", occupants, subtype }), 0, 0, 88, 34);
    return s.log.filter((l) => l === FIGURE).length;
  };

  it("an empty subtyped shop paints the same figures whatever its id", () => {
    // THE path that matters: every shop the player builds gets a subtype rolled
    // at placement, so the legacy `subtype: undefined` branch is only reached by
    // old saves. The retired `hash(u.id) > 0.4` fallback fed the `busy` flag
    // that nine of the trade interiors draw a standing customer from, and it
    // survived here after the legacy branch was cleaned. An id-dependent figure
    // count is exactly that ghost's signature, since the hash was the only thing
    // an empty shop's population could vary on.
    const varying: string[] = [];
    for (const subtype of SHOP_SUBTYPES) {
      const counts = new Set(Array.from({ length: 12 }, (_, i) => shopFigures(subtype, i + 1, 0)));
      if (counts.size > 1) varying.push(`${subtype}: ${[...counts].join("/")}`);
    }
    expect(varying, "empty shops painted an id-dependent ghost shopper").toEqual([]);
  });

  it("a subtyped shop gains a figure once it has customers", () => {
    // Proves the gate still lets the real customer through, so the test above
    // cannot pass by the interiors having quietly stopped drawing one at all.
    expect(shopFigures("Book Store", 1, 3)).toBeGreaterThan(shopFigures("Book Store", 1, 0));
  });

  it("the legacy subtype-less shop draws no shopper either", () => {
    const shopper: number[] = [];
    for (let id = 1; id <= 40; id++) {
      const s = spyCtx();
      drawUnit(draw({}, s.ctx), unit({ id, kind: "shop", occupants: 0, subtype: undefined }), 0, 0, 88, 34);
      if (s.log.includes(LEGACY_FIGURE)) shopper.push(id);
    }
    expect(shopper, "empty legacy shops painted ghost shoppers").toEqual([]);
  });

  it("the legacy subtype-less shop with customers still draws one", () => {
    const s = spyCtx();
    drawUnit(draw({}, s.ctx), unit({ id: 1, kind: "shop", occupants: 3, subtype: undefined }), 0, 0, 88, 34);
    expect(s.log).toContain(LEGACY_FIGURE);
  });
});

describe("entrance staff are gated on the tower holding anyone (#552)", () => {
  // The grand entrance is stamped on the leftmost floor-1 lobby run of EVERY
  // tower, so before this gate a brand-new tower opened with a doorman and a
  // receptionist already at work at population zero.
  const GOLD_TRIM = "fillStyle=#c9a94c"; // the doorman's collar and cuffs

  const entrance = (kind: EntranceKind, staffed: boolean | undefined) => {
    const s = spyCtx();
    drawLobbyEntrance(draw({ staffed }, s.ctx), kind, 0, 0, 11, 34);
    return s;
  };

  it("hides the doorman in an unpopulated tower", () => {
    expect(entrance("grand-right", false).log).not.toContain(GOLD_TRIM);
  });

  it("shows the doorman once the tower holds someone", () => {
    expect(entrance("grand-right", true).log).toContain(GOLD_TRIM);
  });

  it("treats an unthreaded staffed flag as staffed, so the gallery is unchanged", () => {
    expect(entrance("grand-right", undefined).log).toContain(GOLD_TRIM);
  });

  it("keeps the reception desk when it hides the receptionist", () => {
    const bare = entrance("grand-left", false);
    expect(bare.log).not.toContain(FIGURE);
    expect(bare.log).toContain("fillStyle=#6B4A2B"); // the walnut counter stands
  });

  it("the grand-entrance bake threads staffed through to the draw", () => {
    // A source guard, because the bake itself allocates an `ex.Canvas` and so
    // lives on the Playwright tier: the cases above call `drawLobbyEntrance`
    // directly, which cannot catch the bake handing it a DrawCtx literal that
    // omits `staffed`. That is exactly how this gate first shipped dead: the
    // closure built `{ ctx, lit, anim, hour }` by hand, `staffed` came through
    // undefined, and every tower stayed staffed while the unit tests passed.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "excalibur", "towerScene.ts"), "utf8");
    const bakeGrand = src.slice(src.indexOf("const bakeGrand"), src.indexOf("const bakeService"));
    expect(bakeGrand).toContain("staffed: engine.d.staffed");
  });
});
