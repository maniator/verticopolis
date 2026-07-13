import { describe, it, expect } from "vitest";
import { noticeBadge, vacancy, closedShutter, type RoomCtx } from "../render/pixelSprites/common";

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
