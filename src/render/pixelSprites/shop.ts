import type { Unit } from "../../engine/types";
import { SHIRTS, closedShutter, hash, person, shell, type RoomCtx } from "./common";
import { SHOP_LOOKS } from "./shop.looks";
import { drawShopInterior, drawShopSignage, type ShopGeom } from "./shop.interiors";

/**
 * Retail shop art plus its canon subtype look table. Every shop keeps the two
 * anchor shapes the player names a store by: the striped awning, and (on the
 * subtyped path) a lit sign board below it. Each of the eleven canon trades
 * then furnishes its own interior, ported from its board tile in
 * `page-04-retail.build.js` (see `shop.interiors.ts`). An undefined or unknown
 * subtype falls back to the legacy generic shop, byte-identical.
 */

// The canon look table lives in `shop.looks.ts` (split out for file-size
// headroom). Re-exported here so the `pixelSprites.ts` barrel and
// `subtypeVisuals` keep importing it from `./shop` unchanged.
export { SHOP_LOOKS };
export type { ShopLook } from "./shop.looks";

// ---- Shop ---------------------------------------------------------------

export function shop(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  if (u.state === "occupied" && !(d.hour >= 10 && d.hour < 21)) return closedShutter(d, x, y, w, h, "#b58ad6");
  // Subtype look (canon variant); unknown/undefined = the legacy generic shop
  // whose awning accent comes from the unit id (kept byte-identical).
  const look = u.subtype !== undefined ? SHOP_LOOKS[u.subtype] : undefined;
  const floorY = shell(ctx, x, y, w, h, look?.wall ?? "#EFE9F5", "#C8BCD2");
  // Striped awning, the retail anchor shape: every variety keeps the stripes,
  // and the accent is the variety's own so two Flower Shops match and a
  // variety reroll visibly changes the room.
  const accent = look?.awning ?? SHIRTS[(u.id + 2) % SHIRTS.length];
  const band = Math.max(3, h * 0.14);
  for (let sx = x; sx < x + w; sx += 10) {
    ctx.fillStyle = Math.floor((sx - x) / 10) % 2 === 0 ? "#FFFFFF" : accent;
    ctx.fillRect(sx, y, 5, band);
  }
  if (look === undefined) {
    // Legacy generic shop: two shelves of colorful goods, kept verbatim.
    const goods = ["#e85d5d", "#5db4e8", "#6bd47a", "#e8c14a", "#b07fe0", "#e88f4a"];
    for (let row = 0; row < 2; row++) {
      const ry = y + h * 0.34 + row * (h * 0.22);
      ctx.fillStyle = "#A98A6A";
      ctx.fillRect(x + 4, ry + 4, w - 8, 1);
      for (let gx = x + 6, k = 0; gx + 3 < x + w - 5; gx += 6, k++) {
        ctx.fillStyle = goods[(k + row) % goods.length];
        ctx.fillRect(gx, ry, 4, 4);
      }
    }
    if (u.occupants > 0 || hash(u.id) > 0.4) person(ctx, x + w - 9, floorY, 1.5, (u.id * 11) | 0);
    return;
  }
  // Subtyped shop: the enriched awning trim and lit sign, then the trade's own
  // interior. The draw reads only bake-signature inputs (subtype via the look,
  // occupants, lit, and the deterministic id hash), so a static room stays
  // cacheable and re-bakes on a variety reroll.
  const awningBottom = Math.round(y + band);
  const geom: ShopGeom = {
    x,
    y,
    w,
    h,
    floorY,
    awningBottom,
    railY: awningBottom + 8,
    busy: u.occupants > 0 || hash(u.id) > 0.4,
    occupants: u.occupants,
    seed: (u.id * 11) | 0,
    lit: d.lit,
  };
  drawShopSignage(ctx, geom, accent);
  drawShopInterior(ctx, look, geom);
}
