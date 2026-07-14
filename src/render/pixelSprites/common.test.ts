import { describe, it, expect } from "vitest";
import {
  noticeBadge,
  vacancy,
  closedShutter,
  type RoomCtx,
  PAL,
  SHIRTS,
  RESERVED_COLORS,
  moodTint,
  personFigure,
  personSeated,
  personStanding,
  personWalker,
  personRider,
  personHiVis,
  type PersonBuild,
} from "./common";

/**
 * Gap-fill coverage for the pixelSprites/common draw helpers that the broader
 * sprite suite does not reach: the on-notice ribbon, the vacant-lease card, and
 * the closed-shutter shopfront. Pixel fidelity is the Playwright visual tier's
 * job; here we drive the real draw code against a recording spy context to prove
 * each helper paints, and that its width-gated label branch genuinely toggles.
 */

/** A recording 2D-context stand-in: every draw call and style set is logged so a
 *  narrow vs. wide draw can be compared for a real difference. */
function spyCtx() {
  const log: string[] = [];
  const ctx: Record<string, unknown> = {};
  for (const m of [
    "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc",
    "fill", "stroke", "fillRect", "strokeRect", "fillText", "translate", "scale",
  ]) {
    ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  }
  const track = ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign"];
  for (const p of track) {
    let v: unknown;
    Object.defineProperty(ctx, p, {
      get: () => v,
      set: (nv) => {
        v = nv;
        log.push(`${p}=${String(nv)}`);
      },
    });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const room = (ctx: CanvasRenderingContext2D): RoomCtx => ({ ctx, lit: false, anim: 0, hour: 12 });

describe("pixelSprites/common draw helpers", () => {
  it("noticeBadge paints the amber ribbon, and no-ops safely on a degenerate size", () => {
    const wide = spyCtx();
    noticeBadge(wide.ctx, 0, 0, 40, 30);
    expect(wide.log).toContain("fillStyle=#E8A030"); // the ribbon color was set
    expect(wide.log.some((l) => l.startsWith("fill:"))).toBe(true); // the triangle filled

    // s = min(12, w-2, h-2); a 1x1 unit gives s <= 0 and the helper returns
    // before touching the context.
    const tiny = spyCtx();
    noticeBadge(tiny.ctx, 0, 0, 1, 1);
    expect(tiny.log).toEqual([]);
  });

  it("vacancy draws the LEASE card only when wide enough for the label", () => {
    const narrow = spyCtx();
    vacancy(narrow.ctx, 0, 0, 20, 20); // w <= 26: hatch only, no label
    expect(narrow.log.some((l) => l.startsWith("fillText:"))).toBe(false);

    const wide = spyCtx();
    vacancy(wide.ctx, 0, 0, 40, 20, "LEASE"); // w > 26: label plate + text
    const text = wide.log.find((l) => l.startsWith("fillText:"));
    expect(text).toBeDefined();
    expect(text).toContain("LEASE");
  });

  it("closedShutter draws the CLOSED plate only above its width threshold", () => {
    const narrow = spyCtx();
    closedShutter(room(narrow.ctx), 0, 0, 20, 20, "#8899aa"); // w <= 28: slats only
    expect(narrow.log.some((l) => l.startsWith("fillText:"))).toBe(false);

    const wide = spyCtx();
    closedShutter(room(wide.ctx), 0, 0, 40, 20, "#8899aa"); // w > 28: CLOSED label
    const text = wide.log.find((l) => l.startsWith("fillText:"));
    expect(text).toBeDefined();
    expect(text).toContain("CLOSED");
  });
});

/** Read every `fillRect:[x,y,w,h]` the spy recorded back as number tuples. */
function rects(log: string[]): number[][] {
  return log.filter((l) => l.startsWith("fillRect:")).map((l) => JSON.parse(l.slice("fillRect:".length)) as number[]);
}

describe("pixelSprites/common person family and palette", () => {
  it("moodTint returns exactly the three finalized mood colors", () => {
    expect(moodTint("content", 0)).toBe(SHIRTS[0]);
    expect(moodTint("content", 3)).toBe(SHIRTS[3 % SHIRTS.length]);
    expect(moodTint("impatient", 0)).toBe("#E8862A"); // distinct from notice amber #E8A030
    expect(moodTint("fedUp", 0)).toBe("#C24A3A"); // the reserved stress red, deliberate
  });

  it("personFigure paints the pinned head, torso-edge, and contact-shadow literals", () => {
    const { ctx, log } = spyCtx();
    personFigure(ctx, 10, 40, "seated", "#5A6E8C");
    expect(log).toContain("fillStyle=#E8C9A0"); // skin field
    expect(log).toContain("fillStyle=#3A2E28"); // 1px hair line
    expect(log).toContain("fillStyle=#F0D8B8"); // 1px eye highlight
    expect(log).toContain("fillStyle=rgba(0,0,0,0.24)"); // 1px contact shadow
    expect(log.some((l) => l.startsWith("fillStyle=rgb("))).toBe(true); // shaded torso edges
  });

  it("every build draws at integer coordinates only", () => {
    for (const build of ["seated", "standing", "walker", "rider", "hiVis"] as PersonBuild[]) {
      const { ctx, log } = spyCtx();
      personFigure(ctx, 12.4, 44.6, build, "#3F8C84");
      for (const r of rects(log)) for (const n of r) expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("the builds match the finalized heights (15 / 18 / 24 / 17 / 22)", () => {
    const heightOf = (build: PersonBuild): number => {
      const { ctx, log } = spyCtx();
      personFigure(ctx, 10, 100, build, "#5A6E8C");
      const topY = Math.min(...rects(log).map((r) => r[1]));
      return 100 - topY; // baseline minus the topmost pixel
    };
    expect(heightOf("seated")).toBe(15);
    expect(heightOf("standing")).toBe(18);
    expect(heightOf("walker")).toBe(24);
    expect(heightOf("rider")).toBe(17);
    expect(heightOf("hiVis")).toBe(22);
  });

  it("each named wrapper draws its own build (catches a wrong build literal)", () => {
    const cases: [(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number) => void, number][] = [
      [personSeated, 15],
      [personStanding, 18],
      [personWalker, 24],
      [personRider, 17],
      [personHiVis, 22],
    ];
    for (const [fn, expected] of cases) {
      const { ctx, log } = spyCtx();
      fn(ctx, 10, 100, 3);
      const topY = Math.min(...rects(log).map((r) => r[1]));
      expect(100 - topY).toBe(expected);
    }
  });

  it("width-6 builds draw two separated legs, not one merged block", () => {
    // The standing build (width 6) must leave a gap between the two legs.
    const { ctx, log } = spyCtx();
    personFigure(ctx, 10, 100, "standing", "#5A6E8C");
    // Ink legs are the only 2px-wide rects at the leg band (foot-4 .. foot).
    const legRects = rects(log).filter((r) => r[2] === 2 && r[3] === 4);
    expect(legRects.length).toBe(2);
    const [a, b] = legRects.map((r) => r[0]).sort((p, q) => p - q);
    expect(b - a).toBeGreaterThanOrEqual(3); // left leg ends before the right leg starts
  });

  it("no new PAL key and no shirt reuses a reserved state color", () => {
    // Derive the decoration keys from PAL (anchors excluded) so a key added
    // later is caught without editing this list. The anchor `red` is itself the
    // reserved stress red and stays a state cue, not decoration.
    const ANCHORS = ["wall", "floor", "slate", "brass", "red", "blue", "green", "ink", "white", "wood"];
    for (const a of ANCHORS) expect(Object.keys(PAL)).toContain(a); // anchors still present
    const newKeys = Object.keys(PAL).filter((k) => !ANCHORS.includes(k)) as (keyof typeof PAL)[];
    expect(newKeys.length).toBeGreaterThan(0);
    for (const k of newKeys) expect(RESERVED_COLORS as readonly string[]).not.toContain(PAL[k]);
    for (const s of SHIRTS) expect(s).not.toBe("#C24A3A"); // the SHIRTS/stress-red invariant
  });
});
