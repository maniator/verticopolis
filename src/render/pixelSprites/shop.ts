import type { Unit } from "../../engine/types";
import { PAL, SHIRTS, closedShutter, hash, person, shell, type RoomCtx } from "./common";

/**
 * Retail shop art plus its canon subtype look table. Extracted verbatim from
 * `pixelSprites.ts`. Every shop keeps the striped awning anchor shape, and each
 * trade furnishes its own interior. An undefined subtype falls back to the
 * legacy generic shop, byte-identical.
 */

export interface ShopLook {
  awning: string;
  wall: string;
  goods: string[];
  /** Full interior composition per trade: racks, cages, bookcases, a teller
   *  counter... The striped awning above is the one shape every shop keeps. */
  interior:
    | "racks"
    | "pets"
    | "florist"
    | "books"
    | "pharmacy"
    | "boutique"
    | "screens"
    | "bank"
    | "salon"
    | "post"
    | "sports";
}
export const SHOP_LOOKS: Record<string, ShopLook> = {
  "Men's Clothing": { awning: "#5A6E8C", wall: "#ECEEF2", goods: ["#3E4654", "#5A6E8C", "#6E5A4A", "#F4F0E4"], interior: "racks" },
  "Pet Store": { awning: "#8C6E50", wall: "#F0EEE2", goods: ["#C99A6E", "#E8C14A", "#5AA85A", "#F4F0E4"], interior: "pets" },
  "Flower Shop": { awning: "#E88AB0", wall: "#F2F5EC", goods: ["#e85d5d", "#E88AB0", "#e8c14a", "#F4F0E4"], interior: "florist" },
  "Book Store": { awning: "#3E4654", wall: "#F0EAD8", goods: ["#8C3A32", "#3E5A8C", "#4A7A4A", "#B08A3E", "#5A4A6E"], interior: "books" },
  "Drug Store": { awning: "#3A8A4A", wall: "#F4F7F2", goods: ["#FFFFFF", "#9FD0C8", "#5db4e8", "#E8E4D0"], interior: "pharmacy" },
  "Boutique": { awning: "#9A5FB0", wall: "#F5EFF7", goods: ["#E8B8CC", "#C8A8E0", "#F0E0B8", "#F4F0E4"], interior: "boutique" },
  "Electronics": { awning: "#2A2E38", wall: "#3E4654", goods: ["#4FA0C8", "#8FB6FF", "#5db4e8", "#2A2E38"], interior: "screens" },
  "Bank": { awning: "#D8B05A", wall: "#EDE9E2", goods: ["#D8B05A", "#B89040", "#EDE9E2"], interior: "bank" },
  "Hair Salon": { awning: "#B84848", wall: "#F2ECF0", goods: ["#8FB6D8", "#C8DCE8", "#F4F0E4"], interior: "salon" },
  "Post Office": { awning: "#4F6EC8", wall: "#EFEDE4", goods: ["#F4F0E4", "#E0CFA8", "#FFFFFF", "#C8B890"], interior: "post" },
  "Sports Gear": { awning: "#E88F4A", wall: "#EEF2F0", goods: ["#e85d5d", "#5db4e8", "#6bd47a", "#e8c14a"], interior: "sports" },
};

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
  // Each trade furnishes its own room; the goods palette colors the details.
  const g = look.goods;
  const midY = Math.round(y + h * 0.36);
  switch (look.interior) {
    case "racks": {
      // Two clothing rails with hanging garments, and a dressed mannequin.
      for (const railY of [midY, Math.round(y + h * 0.6)]) {
        ctx.fillStyle = "#8A8A92";
        ctx.fillRect(x + 5, railY, Math.round(w * 0.6), 1);
        for (let gx = x + 7, k = 0; gx + 3 < x + Math.round(w * 0.6); gx += 5, k++) {
          ctx.fillStyle = g[k % g.length];
          ctx.fillRect(gx, railY + 1, 3, 6);
        }
      }
      const mx = x + w - 12;
      ctx.fillStyle = "#C8C8C8"; // plinth
      ctx.fillRect(mx, floorY - 2, 6, 2);
      ctx.fillStyle = g[0]; // suited mannequin
      ctx.fillRect(mx + 1, floorY - 9, 4, 7);
      ctx.fillStyle = "#E8E4DA";
      ctx.fillRect(mx + 2, floorY - 11, 2, 2);
      break;
    }
    case "pets": {
      // A cage stack and a glowing aquarium.
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          const cx = x + 6 + col * 11;
          const cy = midY + row * 8;
          ctx.fillStyle = "#B8A890";
          ctx.fillRect(cx, cy, 9, 6);
          ctx.fillStyle = "#8A7A64"; // bars
          for (let bx = cx + 1; bx < cx + 9; bx += 2) ctx.fillRect(bx, cy + 1, 1, 4);
          ctx.fillStyle = g[(row * 2 + col) % g.length]; // the resident
          ctx.fillRect(cx + 3, cy + 3, 3, 2);
        }
      }
      const ax = x + Math.max(30, Math.round(w * 0.55));
      ctx.fillStyle = "#2A4A64"; // aquarium
      ctx.fillRect(ax, floorY - 9, 14, 7);
      ctx.fillStyle = "#4FA0C8";
      ctx.fillRect(ax + 1, floorY - 8, 12, 5);
      ctx.fillStyle = "#E88F4A"; // fish
      ctx.fillRect(ax + 3, floorY - 6, 2, 1);
      ctx.fillRect(ax + 8, floorY - 7, 2, 1);
      break;
    }
    case "florist": {
      // Tiered flower stands and floor buckets in bloom.
      for (const [tierY, tierX, tierW] of [
        [midY, x + 5, Math.round(w * 0.5)],
        [Math.round(y + h * 0.58), x + 8, Math.round(w * 0.4)],
      ] as const) {
        ctx.fillStyle = "#A98A6A";
        ctx.fillRect(tierX, tierY + 4, tierW, 1);
        for (let gx = tierX + 2, k = 0; gx + 3 < tierX + tierW; gx += 5, k++) {
          ctx.fillStyle = "#4A7A4A"; // stem
          ctx.fillRect(gx + 1, tierY + 1, 1, 3);
          ctx.fillStyle = g[k % g.length]; // bloom
          ctx.fillRect(gx, tierY - 1, 3, 3);
        }
      }
      for (let bx = x + w - 18, k = 0; k < 2; bx += 8, k++) {
        ctx.fillStyle = "#8A8A92"; // bucket
        ctx.fillRect(bx, floorY - 4, 5, 4);
        ctx.fillStyle = g[(k + 1) % g.length];
        ctx.fillRect(bx, floorY - 6, 5, 2);
      }
      break;
    }
    case "books": {
      // Two full bookcases of spines and a reading table.
      for (const cx of [x + 5, x + Math.round(w * 0.4)]) {
        const cw = Math.min(18, Math.round(w * 0.26));
        ctx.fillStyle = "#6A5240"; // case
        ctx.fillRect(cx, midY - 3, cw, floorY - midY + 3);
        for (let row = 0; row < 2; row++) {
          for (let bx = cx + 2, k = 0; bx + 2 < cx + cw - 1; bx += 3, k++) {
            ctx.fillStyle = g[(k + row) % g.length];
            ctx.fillRect(bx, midY - 1 + row * 6, 2, 5);
          }
        }
      }
      ctx.fillStyle = "#8C6E50"; // reading table
      ctx.fillRect(x + w - 16, floorY - 5, 10, 2);
      ctx.fillStyle = g[1];
      ctx.fillRect(x + w - 13, floorY - 6, 3, 1);
      break;
    }
    case "pharmacy": {
      // Dispensing counter with a white-coated pharmacist, one aisle, the cross.
      ctx.fillStyle = "#3A8A4A";
      ctx.fillRect(x + w - 12, y + band + 2, 6, 2);
      ctx.fillRect(x + w - 10, y + band, 2, 6);
      const cw = Math.round(w * 0.36);
      ctx.fillStyle = "#F4F4F0"; // counter
      ctx.fillRect(x + 5, floorY - 7, cw, 5);
      person(ctx, x + 5 + Math.round(cw / 2), floorY - 7, 1.2, (u.id * 17) | 0, false, "#F4F0E4");
      ctx.fillStyle = "#A98A6A"; // aisle shelf
      ctx.fillRect(x + cw + 12, midY + 4, Math.round(w * 0.3), 1);
      for (let gx = x + cw + 14, k = 0; gx + 3 < x + cw + 12 + Math.round(w * 0.3); gx += 6, k++) {
        ctx.fillStyle = g[k % g.length];
        ctx.fillRect(gx, midY, 4, 4);
      }
      break;
    }
    case "boutique": {
      // Sparse chic: one short rail, a mannequin, a tall mirror.
      ctx.fillStyle = "#8A8A92";
      ctx.fillRect(x + 6, midY, Math.round(w * 0.3), 1);
      for (let gx = x + 9, k = 0; k < 3; gx += 8, k++) {
        ctx.fillStyle = g[k % g.length];
        ctx.fillRect(gx, midY + 1, 3, 6);
      }
      const mx = x + Math.round(w * 0.55);
      ctx.fillStyle = "#C8C8C8";
      ctx.fillRect(mx, floorY - 2, 6, 2);
      ctx.fillStyle = g[0];
      ctx.fillRect(mx + 1, floorY - 9, 4, 7);
      ctx.fillStyle = "#E8E4DA";
      ctx.fillRect(mx + 2, floorY - 11, 2, 2);
      ctx.fillStyle = "#B8C8D4"; // tall mirror
      ctx.fillRect(x + w - 10, midY - 2, 4, floorY - midY);
      ctx.fillStyle = "#8A8A92";
      ctx.fillRect(x + w - 11, midY - 3, 6, 1);
      break;
    }
    case "screens": {
      // A wall of glowing demo screens over a gadget counter.
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < Math.max(2, Math.floor((w - 16) / 10)); col++) {
          const sx = x + 6 + col * 10;
          if (sx + 7 > x + w - 6) break;
          ctx.fillStyle = "#15151C"; // bezel
          ctx.fillRect(sx, midY - 4 + row * 7, 7, 5);
          ctx.fillStyle = g[(row + col) % 3];
          ctx.fillRect(sx + 1, midY - 3 + row * 7, 5, 3);
        }
      }
      ctx.fillStyle = "#2A2E38"; // demo counter
      ctx.fillRect(x + 6, floorY - 4, w - 12, 3);
      ctx.fillStyle = g[1];
      ctx.fillRect(x + 10, floorY - 5, 3, 1);
      ctx.fillRect(x + Math.round(w / 2), floorY - 5, 3, 1);
      break;
    }
    case "bank": {
      // Teller counter with divider windows, a vault door, the brass coin.
      const cw = Math.round(w * 0.5);
      ctx.fillStyle = "#D8D4C8"; // counter
      ctx.fillRect(x + 5, floorY - 7, cw, 5);
      for (const wx of [x + 9, x + 9 + Math.round(cw / 2)]) {
        ctx.fillStyle = "#6A5240"; // teller window
        ctx.fillRect(wx, floorY - 12, 6, 5);
        ctx.fillStyle = "#E8E4DA";
        ctx.fillRect(wx + 1, floorY - 11, 4, 3);
      }
      const vx = x + w - 12;
      ctx.fillStyle = "#8A8A92"; // vault door
      ctx.beginPath();
      ctx.arc(vx, floorY - 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5A5A62";
      ctx.beginPath();
      ctx.arc(vx, floorY - 6, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.brass; // the coin over the counter
      ctx.beginPath();
      ctx.arc(x + 8 + Math.round(cw / 2), y + band + 5, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "salon": {
      // Two styling stations (mirror + chair) and the barber pole.
      for (const sx of [x + 7, x + 7 + Math.round(w * 0.3)]) {
        ctx.fillStyle = "#C8DCE8"; // mirror
        ctx.fillRect(sx, midY - 3, 5, 6);
        ctx.fillStyle = "#8A8A92";
        ctx.fillRect(sx - 1, midY - 4, 7, 1);
        ctx.fillStyle = "#3E4654"; // chair
        ctx.fillRect(sx, floorY - 6, 4, 4);
        ctx.fillRect(sx + 1, floorY - 2, 2, 2);
      }
      const px = x + w - 9;
      ctx.fillStyle = "#F4F0E4"; // pole
      ctx.fillRect(px, y + band + 2, 3, 10);
      for (let py = 0; py < 10; py += 4) {
        ctx.fillStyle = py % 8 === 0 ? "#B84848" : "#4F6EC8";
        ctx.fillRect(px, y + band + 2 + py, 3, 2);
      }
      break;
    }
    case "post": {
      // Service counter, a stagger of parcels, and the mail drop box.
      const cw = Math.round(w * 0.34);
      ctx.fillStyle = "#D8D4C8";
      ctx.fillRect(x + 5, floorY - 7, cw, 5);
      person(ctx, x + 5 + Math.round(cw / 2), floorY - 7, 1.2, (u.id * 19) | 0);
      const pxs = x + cw + 12;
      ctx.fillStyle = "#C8A87A"; // parcels
      ctx.fillRect(pxs, floorY - 4, 6, 4);
      ctx.fillRect(pxs + 7, floorY - 4, 5, 4);
      ctx.fillStyle = "#B8986A";
      ctx.fillRect(pxs + 3, floorY - 8, 6, 4);
      ctx.fillStyle = "#4F6EC8"; // drop box
      ctx.fillRect(x + w - 11, floorY - 8, 5, 8);
      ctx.fillStyle = "#2A3A6A";
      ctx.fillRect(x + w - 10, floorY - 6, 3, 1);
      break;
    }
    case "sports": {
      // A ball bin, a stick rack, and a jersey on the wall.
      ctx.fillStyle = "#8A8A92"; // bin
      ctx.fillRect(x + 6, floorY - 5, 10, 5);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = g[k % g.length];
        ctx.beginPath();
        ctx.arc(x + 9 + k * 3, floorY - 5, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let rx = x + Math.round(w * 0.42), k = 0; k < 4; rx += 3, k++) {
        ctx.fillStyle = k % 2 === 0 ? "#C8A87A" : "#A8845C"; // bats and sticks
        ctx.fillRect(rx, floorY - 9, 1, 9);
      }
      const jx = x + w - 13;
      ctx.fillStyle = g[0]; // jersey
      ctx.fillRect(jx, midY - 2, 7, 6);
      ctx.fillRect(jx - 1, midY - 2, 2, 3);
      ctx.fillRect(jx + 6, midY - 2, 2, 3);
      break;
    }
  }
  if (u.occupants > 0 || hash(u.id) > 0.4) person(ctx, x + w - 9, floorY, 1.5, (u.id * 11) | 0);
}
