import { describe, it, expect } from "vitest";
import type { Unit } from "../../engine/types";
import { drawRoom } from "../pixelSprites";
import { geoVariant, shade, type RoomCtx } from "./common";
import { ART_TILE } from "./artScale";
import { FLOOR, TILE } from "../scale";
import { AMUSEMENTS_LOOKS } from "./amusements";
import { BOUTIQUE_LOOKS } from "./boutique";

/**
 * Room capacity at FULL population: how many occupants a room can put on screen
 * at once.
 *
 * The "occupancy is honest" suite next door asserts min(present, seats) for
 * three occupants, which cannot see the seat count itself fall. That blind spot
 * is what let issue #813 ship: the world scale moved from an 11px tile to a
 * 10px one, room furniture kept its authored pixel pitches, and several layouts
 * quietly lost a slot, so workers and shoppers who were present stopped being
 * drawn at all. Under-drawing is the opposite failure from a ghost and just as
 * wrong, so it needs its own guard.
 *
 * Capacity belongs to the ROOM, and a room's width in TILES is what the scale
 * change left alone, so every count here is stated as the authored-art
 * arithmetic behind it: how many of an item's authored pitch fit across the room
 * at the tile the art was drawn for, once the row's own margins come off.
 * Written that way an expectation survives another scale move, which a number
 * copied out of today's renderer would not.
 *
 * All eight populated kinds that lay furniture out in a row are covered: office,
 * amusements, boutiqueBay, skyBar, nightclub, daycare, fitnessClub, and spa.
 * Seven of the eight carried the defect; the spa is covered because a capacity
 * claim is worth pinning either way, not because it lost a slot (it did not,
 * for the reason given at its own case below).
 *
 * Two things a room draws are NOT its occupants and are counted separately here.
 * Staff (the bar's bartender, the club's DJ, the daycare's caregiver) appear
 * because the room is open, not because a visitor is standing there. And some
 * occupants are not drawn as the shared person build at all: a daycare's
 * children are their own small silhouette, and a spa guest on a massage table is
 * a fold of linen.
 */

/** A recording 2D-context stand-in: every draw call and style set is logged. */
function spyCtx() {
  const log: string[] = [];
  const ctx: Record<string, unknown> = {};
  for (const m of [
    "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc",
    "fill", "stroke", "fillRect", "strokeRect", "fillText", "translate", "scale",
  ]) {
    ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  }
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "globalAlpha"]) {
    let v: unknown;
    Object.defineProperty(ctx, p, { get: () => v, set: (nv) => { v = nv; log.push(`${p}=${String(nv)}`); } });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

/** An hour each kind is actually open. A closed venue paints its shutter and
 *  nobody at all, so measuring a bar at noon measures nothing. */
const OPEN_HOUR: Record<string, number> = { skyBar: 20, nightclub: 22 };
const room = (ctx: CanvasRenderingContext2D, kind?: string): RoomCtx =>
  ({ ctx, lit: false, anim: 0, hour: OPEN_HOUR[kind ?? ""] ?? 12 });

/** How many finalized figures were drawn: the person builds stamp one unique
 *  contact-shadow literal per figure and nothing else does. */
const peopleCount = (log: string[]): number => log.filter((l) => l === "fillStyle=rgba(0,0,0,0.24)").length;

/** Daycare children are their own small silhouette, not the shared person build,
 *  so they carry no contact shadow. They do share the skin literal with an adult
 *  head, so subtract the adults to count them. */
const childCount = (log: string[]): number =>
  log.filter((l) => l === "fillStyle=#E8C9A0").length - peopleCount(log);

/** A spa guest on a massage table is a fold of shaded linen, not a figure. */
const bedGuestCount = (log: string[]): number =>
  log.filter((l) => l === `fillStyle=${shade("#f0ece2", -10)}`).length;

/** How many times one fill color was set: the count of a single repeated prop. */
const propCount = (color: string) => (log: string[]): number => log.filter((l) => l === `fillStyle=${color}`).length;

/** The x of the first figure drawn: its contact shadow is the first rect after
 *  the shadow fill color is set, and it starts one pixel left of the figure. */
function firstPersonX(log: string[]): number | undefined {
  const at = log.indexOf("fillStyle=rgba(0,0,0,0.24)");
  if (at < 0) return undefined;
  const rect = log.slice(at + 1).find((l) => l.startsWith("fillRect:"));
  return rect === undefined ? undefined : (JSON.parse(rect.slice("fillRect:".length)) as number[])[0] + 1;
}

function unit(over: Partial<Unit>): Unit {
  return { id: 1, floor: 10, x: 20, state: "occupied", satisfaction: 0.8, ...over } as Unit;
}

/** Enough columns to reach every geo-seeded variant: the seed is the unit's
 *  PLACE (floor and x), not its id, so only a sweep over columns sees all of a
 *  kind's layouts and figure seeds. */
const COLUMNS = 200;

/** One measurement per column for a room kind at a given tile width, optionally
 *  narrowed to the columns that draw a particular office layout. */
function sweep(
  over: Partial<Unit>,
  tiles: number,
  measure: (log: string[]) => number,
  only?: (u: Pick<Unit, "kind" | "floor" | "x">) => boolean,
): number[] {
  const out: number[] = [];
  for (let x = 0; x < COLUMNS; x++) {
    const u = unit({ ...over, width: tiles, x });
    if (only && !only(u)) continue;
    const s = spyCtx();
    drawRoom(room(s.ctx, String(u.kind)), u, 0, 0, tiles * TILE, FLOOR);
    out.push(measure(s.log));
  }
  expect(out.length, "the sweep matched no column").toBeGreaterThan(0);
  return out;
}

/** The authored capacity of a row: how many items of `pitch` fit across `span`
 *  AUTHORED pixels once the row's own margins come off. This is the contract the
 *  renderer has to match whatever a tile is currently worth. */
const authoredSeats = (authoredSpan: number, margins: number, pitch: number): number =>
  Math.max(0, Math.floor((authoredSpan - margins) / pitch) + 1);

/** The trades whose shopfront seats a customer in a chair, on top of the
 *  browsing row's own capacity. */
const seatedClients = (subtype: string): number =>
  BOUTIQUE_LOOKS[subtype].trade === "barber" || BOUTIQUE_LOOKS[subtype].trade === "tattoo" ? 1 : 0;

/** Office layout selector: `geoVariant(u, 3, 5)` picks 0-2 cubicle row, 3
 *  meeting, 4 executive. */
const officeLayout = (n: number) => (u: Pick<Unit, "kind" | "floor" | "x">): boolean => geoVariant(u, 3, 5) === n;

describe("a full room draws every occupant it has room for", () => {
  it("the 9-tile office seats 5 in its widest layout and never fewer than 3", () => {
    // Office: 9 tiles, population 6.
    const full = sweep({ kind: "office", occupants: 6 }, 9, peopleCount);
    expect(Math.max(...full)).toBe(5); // the meeting room, the roomiest layout
    // The low end is the load-bearing half: the executive corner fell to two
    // when its chain of furniture overran the narrower room, so a fully staffed
    // office was down to a pair of visible workers.
    expect(Math.min(...full)).toBe(3);
  });

  it("the 9-tile office's executive corner staffs the boss and both side cubicles", () => {
    // The most fragile layout in the fix and the one that regressed hardest: its
    // furniture is a single chain of absolute anchors, and at the shipped width
    // the chain ends 1px inside the wall, where before the fix it ended outside
    // and the second cubicle's worker was dropped. Pinned on its own so the
    // reason a change here fails is unmistakable.
    expect(new Set(sweep({ kind: "office", occupants: 6 }, 9, peopleCount, officeLayout(4)))).toEqual(new Set([3]));
  });

  it("the 9-tile office draws all three workers present, in every layout", () => {
    // Three present is under every layout's seat count, so every column must
    // draw exactly three. One column short means a worker is in the room and
    // invisible.
    expect(new Set(sweep({ kind: "office", occupants: 3 }, 9, peopleCount))).toEqual(new Set([3]));
  });

  it.each([6, 9, 12, 16, 20])("an office %i tiles wide fills its meeting table", (tiles) => {
    // Capacity has to track the room, so sweep widths instead of pinning only
    // the one the catalog ships. The table runs 60% of the room and stops at 60
    // authored pixels; its chairs sit at an authored 11px pitch, 3px in from one
    // end and 6px short of the other. Every term here is authored art, so this
    // expectation never mentions a screen pixel and cannot drift with the tile.
    const table = Math.min(Math.round(tiles * ART_TILE * 0.6), 60);
    const expected = authoredSeats(table, 3 + 6, 11);
    expect(new Set(sweep({ kind: "office", occupants: 40 }, tiles, peopleCount, officeLayout(3)))).toEqual(new Set([expected]));
  });

  it.each([6, 9, 12, 16, 20])("an office %i tiles wide staffs every cubicle in the bank", (tiles) => {
    // The classic layout's bank reserves 12 authored pixels of room around an
    // authored 22px desk slot.
    const expected = Math.max(1, Math.floor((tiles * ART_TILE - 12) / 22));
    for (const layout of [0, 1, 2]) {
      expect(
        new Set(sweep({ kind: "office", occupants: 40 }, tiles, peopleCount, officeLayout(layout))),
        `${tiles} tiles, layout ${layout}`,
      ).toEqual(new Set([expected]));
    }
  });

  it.each([
    ["arcade cabinets", "Classic Arcade", shade(AMUSEMENTS_LOOKS["Classic Arcade"].wall, 26), 11],
    ["claw machines", "Claw Parlor", shade(AMUSEMENTS_LOOKS["Claw Parlor"].neon, -30), 13],
  ])("a hall builds all its %s at every width", (_name, subtype, bodyColor, itemW) => {
    // Amusements: population 25, so the stations are always the binding limit.
    // Counting stations rather than players keeps this pinned to capacity: a
    // player stands at a share of the machines, chosen by a hash, so the figure
    // count also moves when that hash is retuned. Margins are 3 at the near wall
    // and 5 at the far one, which is where the last machine's player stands.
    for (const tiles of [6, 9, 12, 16, 20]) {
      const expected = authoredSeats(tiles * ART_TILE, 3 + 5 + itemW, itemW + 4);
      expect(
        new Set(sweep({ kind: "amusements", occupants: 25, subtype } as Partial<Unit>, tiles, propCount(bodyColor))),
        `${tiles} tiles`,
      ).toEqual(new Set([expected]));
    }
  });

  it("a 12-tile VR lounge fills all three pods", () => {
    // The pod row already sized itself off the room and never lost a slot. It is
    // pinned so a later change to that sizing cannot quietly break it either.
    expect(new Set(sweep({ kind: "amusements", occupants: 25, subtype: "VR Lounge" } as Partial<Unit>, 12, peopleCount))).toEqual(new Set([3]));
  });

  it.each([9, 12, 16, 20])("a mini golf bay %i tiles wide fills the putting green", (tiles) => {
    // One golfer plus a watcher row at an authored 12px pitch, starting 32px in
    // (clear of the golfer and the putter) and ending 7px short of the far wall.
    const expected = 1 + authoredSeats(tiles * ART_TILE, 32 + 7, 12);
    expect(new Set(sweep({ kind: "amusements", occupants: 60, subtype: "Mini Golf" } as Partial<Unit>, tiles, peopleCount))).toEqual(new Set([expected]));
  });

  it.each(Object.keys(BOUTIQUE_LOOKS))("a 12-tile %s bay fills its browsing row", (subtype) => {
    // Boutique Bay: 12 tiles, browsers shoulder to shoulder at an authored 7px
    // pitch, from 7px inside the door back to 3px off the far wall. The barber
    // and tattoo shopfronts hold one more on top of that, in the chair, and it
    // is one of the same customers: the row gives that seat up rather than
    // drawing the person twice.
    const expected = authoredSeats(12 * ART_TILE, 7 + 3, 7) + seatedClients(subtype);
    expect(new Set(sweep({ kind: "boutiqueBay", occupants: 22, subtype } as Partial<Unit>, 12, peopleCount))).toEqual(new Set([expected]));
  });

  it.each([6, 8, 12, 18])("a boutique bay %i tiles wide fills its browsing row", (tiles) => {
    // Widths chosen to cross a whole authored slot in both directions, which is
    // where a count taken off the pixel width parts company with one taken off
    // the room.
    const expected = authoredSeats(tiles * ART_TILE, 7 + 3, 7);
    expect(new Set(sweep({ kind: "boutiqueBay", occupants: 60, subtype: "Florist" } as Partial<Unit>, tiles, peopleCount))).toEqual(new Set([expected]));
  });

  it.each(Object.keys(BOUTIQUE_LOOKS))("a %s bay draws min(present, seats) and stays bounded on a forged count", (subtype) => {
    // Moved here from `sprites.test.ts` with the rest of the bay's capacity
    // coverage. Empty draws nobody; a part-full shop draws exactly who is in it,
    // the barber's and the tattooist's seated client included rather than added
    // on top of the row; a corrupt save carrying a huge `occupants` paints the
    // row's own capacity and returns rather than spinning.
    const W = 12 * TILE;
    const draw = (occupants: number): string[] => {
      const s = spyCtx();
      drawRoom(room(s.ctx, "boutiqueBay"), unit({ kind: "boutiqueBay", width: 12, occupants, subtype } as Partial<Unit>), 0, 0, W, FLOOR);
      return s.log;
    };
    expect(peopleCount(draw(0))).toBe(0);
    for (const present of [1, 2, 5, 12]) expect(peopleCount(draw(present))).toBe(present);
    const forged = spyCtx();
    const huge = unit({ kind: "boutiqueBay", width: 12, occupants: 1e9, subtype } as Partial<Unit>);
    expect(() => drawRoom(room(forged.ctx), huge, 0, 0, W, FLOOR)).not.toThrow();
    expect(peopleCount(forged.log)).toBe(authoredSeats(12 * ART_TILE, 7 + 3, 7) + seatedClients(subtype));
  });

  it.each([
    ["Classic Arcade", shade(AMUSEMENTS_LOOKS["Classic Arcade"].wall, 26)],
    ["Claw Parlor", shade(AMUSEMENTS_LOOKS["Claw Parlor"].neon, -30)],
  ])("a %s puts exactly min(visitors, stations) people at its machines", (subtype, bodyColor) => {
    // The counts above are of MACHINES, which is the honest capacity but says
    // nothing about who is standing at them. This is the occupancy half, and it
    // is where the halls were dishonest in BOTH directions: the player at each
    // machine used to be decided by a per-machine hash bounded at twice the
    // occupancy, so two visitors could paint four players at one column and none
    // at the next. Sweep every occupancy across the whole seed space.
    for (const occupants of [0, 1, 2, 3, 5, 8, 13, 25]) {
      for (let x = 0; x < COLUMNS; x++) {
        const s = spyCtx();
        drawRoom(room(s.ctx, "amusements"), unit({ kind: "amusements", width: 12, occupants, subtype, x } as Partial<Unit>), 0, 0, 12 * TILE, FLOOR);
        const stations = propCount(bodyColor)(s.log);
        const players = peopleCount(s.log);
        expect(players, `${occupants} visitors, column ${x}: ${players} players at ${stations} stations`)
          .toBe(Math.min(occupants, stations));
      }
    }
  });

  it.each(["Classic Arcade", "Claw Parlor"])("a quiet %s scatters its player instead of banking it left", (subtype) => {
    // The count assertion above says how many, not which. Filling from the left
    // would satisfy it and leave a quiet hall with its whole crowd at one wall,
    // so measure where the lone player actually stands: across rooms it should
    // average the middle of the hall and reach both ends. Asserting only that
    // the position VARIES is not enough, since an implementation that picks the
    // leftmost machine four times in five still varies.
    const xs: number[] = [];
    for (let x = 0; x < COLUMNS; x++) {
      const s = spyCtx();
      drawRoom(room(s.ctx, "amusements"), unit({ kind: "amusements", width: 12, occupants: 1, subtype, x } as Partial<Unit>), 0, 0, 12 * TILE, FLOOR);
      const at = firstPersonX(s.log);
      expect(at, `column ${x}: a hall with a visitor drew nobody`).toBeDefined();
      xs.push(at as number);
    }
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(hi - lo, "the player never moved across the hall").toBeGreaterThan(12 * TILE * 0.5);
    expect(mean, `mean player x ${mean}`).toBeGreaterThan(lo + (hi - lo) * 0.3);
    expect(mean, `mean player x ${mean}`).toBeLessThan(lo + (hi - lo) * 0.7);
  });
});

describe("the showpiece rooms fill their own furniture too", () => {
  // The five kinds the first pass measured but did not fix. Same defect, same
  // shape of fix, same authored-arithmetic expectations.

  it.each([9, 12, 16, 20])("a %i-tile sky bar seats every stool at the counter", (tiles) => {
    // Stools at an authored 7px pitch along the BAR COUNTER, which is the room
    // inset 3px at each end. The bartender is staff and stands beside the count.
    const counter = tiles * ART_TILE - 6;
    const expected = authoredSeats(counter, 3 + 9, 7) + 1;
    expect(new Set(sweep({ kind: "skyBar", occupants: 60 }, tiles, peopleCount))).toEqual(new Set([expected]));
  });

  it.each([12, 16, 20, 24])("a %i-tile nightclub fills its dance floor", (tiles) => {
    // Dancers at an authored 6px pitch along the DANCE FLOOR, which runs from
    // 4px in to 66% of the room. The DJ is staff and stands beside the count.
    const danceFloor = Math.round(tiles * ART_TILE * 0.66) - 4;
    const expected = authoredSeats(danceFloor, 3 + 5, 6) + 1;
    expect(new Set(sweep({ kind: "nightclub", occupants: 60 }, tiles, peopleCount))).toEqual(new Set([expected]));
  });

  it.each([9, 12, 16, 20])("a %i-tile daycare seats every child on the mat", (tiles) => {
    // Children at an authored 6px pitch along the PLAY MAT, which runs from 3px
    // in to 62% of the room. The caregiver is staff and is counted apart.
    const mat = Math.round(tiles * ART_TILE * 0.62) - 3;
    const expected = authoredSeats(mat, 3 + 4, 6);
    expect(new Set(sweep({ kind: "daycare", occupants: 60 }, tiles, childCount))).toEqual(new Set([expected]));
    expect(new Set(sweep({ kind: "daycare", occupants: 60 }, tiles, peopleCount))).toEqual(new Set([1]));
  });

  it.each([12, 16, 20, 24])("a %i-tile yoga studio puts a member on every mat", (tiles) => {
    // Mats at an authored 12px pitch across the room itself.
    const expected = authoredSeats(tiles * ART_TILE, 5 + 14, 12);
    expect(new Set(sweep({ kind: "fitnessClub", occupants: 60, subtype: "Yoga Studio" } as Partial<Unit>, tiles, peopleCount)))
      .toEqual(new Set([expected]));
  });

  it.each([12, 16, 20, 24])("a %i-tile spin studio puts a rider on every bike", (tiles) => {
    // Bikes at an authored 8px pitch across the room itself.
    const expected = authoredSeats(tiles * ART_TILE, 5 + 9, 8);
    expect(new Set(sweep({ kind: "fitnessClub", occupants: 60, subtype: "Spin Studio" } as Partial<Unit>, tiles, peopleCount)))
      .toEqual(new Set([expected]));
  });

  it.each(["Weight Floor", "Boxing Gym", "Climbing Wall"])("a %s shows its one member", (subtype) => {
    // These three formats are built around a single piece of equipment, so their
    // capacity is one and no tile can take it away. Pinned so a later change
    // cannot quietly turn a bench, a heavy bag, or a wall into a row.
    expect(new Set(sweep({ kind: "fitnessClub", occupants: 60, subtype } as Partial<Unit>, 16, peopleCount))).toEqual(new Set([1]));
  });

  it.each([12, 14, 18, 22])("a %i-tile spa fills its tub and all three tables", (tiles) => {
    // The spa is the one kind in this pass with NO capacity defect: its massage
    // tables are capped at three long before the room runs out of wall, so the
    // narrower tile never cost it one. Measured at 11 by 44 and at 10 by 45,
    // three beds either way. Pinned so that stays true.
    //
    // Narrow claim on purpose, twice over. A spa draws at most four of its
    // guests (one in the tub, three on tables) against a catalog population well
    // above that, so a busy spa still shows a fraction of its crowd: that is the
    // room's own design and nothing to do with the tile. And the cap only saves
    // it while the room is wide enough to have wanted three tables anyway; below
    // about 5 tiles the wall binds first and the narrower tile would cost a
    // table. A spa is 14 tiles, so that width cannot occur, but the exemption is
    // about this room at its real size and not a property of the layout.
    expect(new Set(sweep({ kind: "spa", occupants: 60 }, tiles, peopleCount))).toEqual(new Set([1]));
    expect(new Set(sweep({ kind: "spa", occupants: 60 }, tiles, bedGuestCount))).toEqual(new Set([3]));
  });
});

describe("the showpiece rooms draw their crowd honestly", () => {
  // The other half of the contract, and the half none of these kinds kept. Each
  // used to roll a hash per seat and count a skipped seat against the occupancy
  // anyway, so people who were in the room were never drawn. Staff are named
  // separately because they are not occupants.
  it.each([
    ["skyBar", { kind: "skyBar" }, 12, peopleCount, 1],
    ["nightclub", { kind: "nightclub" }, 20, peopleCount, 1],
    ["daycare children", { kind: "daycare" }, 12, childCount, 0],
    ["yoga studio", { kind: "fitnessClub", subtype: "Yoga Studio" }, 16, peopleCount, 0],
    ["spin studio", { kind: "fitnessClub", subtype: "Spin Studio" }, 16, peopleCount, 0],
  ] as [string, Partial<Unit>, number, (log: string[]) => number, number][])(
    "a %s draws exactly its visitors, plus its staff",
    (_label, over, tiles, measure, staff) => {
      for (const present of [0, 1, 2, 3, 5, 8]) {
        const drawn = new Set(sweep({ ...over, occupants: present }, tiles, measure));
        expect(drawn, `${present} present`).toEqual(new Set([present + (present > 0 ? staff : 0)]));
      }
    },
  );

  it("a spa counts the guest in the tub as one of its guests", () => {
    // The tub and the tables were counted separately, so a spa holding one guest
    // showed two: one soaking and one on a table.
    for (const present of [0, 1, 2, 3, 5]) {
      const inTub = new Set(sweep({ kind: "spa", occupants: present }, 14, peopleCount));
      const onTables = new Set(sweep({ kind: "spa", occupants: present }, 14, bedGuestCount));
      expect(inTub, `${present} present, tub`).toEqual(new Set([present > 0 ? 1 : 0]));
      expect(onTables, `${present} present, tables`).toEqual(new Set([Math.min(Math.max(0, present - 1), 3)]));
    }
  });
});

describe("the catalog widths hold the counts measured off the pre-fix art", () => {
  // Plain numbers, deliberately. Everything above is stated as authored-art
  // arithmetic, which keeps those expectations honest across a scale move but
  // also means a matching mistake on both sides would agree with itself. These
  // are counted by rendering the art as it stood BEFORE the tile changed, at 11
  // by 44, so they anchor the arithmetic to something measured. Each is that
  // room's CAPACITY. For the kinds that used to roll a hash per seat, the old
  // art only reached it on its luckiest columns, which is why the sweep takes
  // the max across 200 of them.
  it.each([
    ["office, widest layout", { kind: "office", occupants: 6 }, 9, 5, Math.max],
    ["office, narrowest layout", { kind: "office", occupants: 6 }, 9, 3, Math.min],
    ["Classic Arcade", { kind: "amusements", occupants: 25, subtype: "Classic Arcade" }, 12, 8, Math.max],
    ["VR Lounge", { kind: "amusements", occupants: 25, subtype: "VR Lounge" }, 12, 3, Math.max],
    ["Claw Parlor", { kind: "amusements", occupants: 25, subtype: "Claw Parlor" }, 12, 7, Math.max],
    ["Mini Golf", { kind: "amusements", occupants: 25, subtype: "Mini Golf" }, 12, 9, Math.max],
    ["Florist bay", { kind: "boutiqueBay", occupants: 22, subtype: "Florist" }, 12, 18, Math.max],
    ["Barber bay", { kind: "boutiqueBay", occupants: 22, subtype: "Barber" }, 12, 19, Math.max],
    ["sky bar", { kind: "skyBar", occupants: 22 }, 12, 18, Math.max],
    ["nightclub", { kind: "nightclub", occupants: 30 }, 20, 24, Math.max],
    ["yoga studio", { kind: "fitnessClub", occupants: 20, subtype: "Yoga Studio" }, 16, 14, Math.max],
    // Over the catalog population of 20 on purpose: a 16-tile studio holds 21
    // bikes, so at 20 this row would be occupancy-bound and would still pass
    // with a bike missing.
    ["spin studio", { kind: "fitnessClub", occupants: 60, subtype: "Spin Studio" }, 16, 21, Math.max],
    ["spa", { kind: "spa", occupants: 18 }, 14, 1, Math.max],
  ] as [string, Partial<Unit>, number, number, (...n: number[]) => number][])(
    "%s draws %i# people at its catalog width",
    (_label, over, tiles, expected, pick) => {
      expect(pick(...sweep(over, tiles, peopleCount))).toBe(expected);
    },
  );

  it("a 12-tile daycare puts 13 children on the mat", () => {
    // Counted apart because a child is not the shared person build.
    expect(Math.max(...sweep({ kind: "daycare", occupants: 14 }, 12, childCount))).toBe(13);
  });

  it("a 14-tile spa lays guests on all three tables", () => {
    expect(Math.max(...sweep({ kind: "spa", occupants: 18 }, 14, bedGuestCount))).toBe(3);
  });
});
