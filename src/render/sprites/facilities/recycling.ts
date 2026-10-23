import type { UnitView } from "../../../simport/view";
import { personHiVis } from "../../pixelSprites/common";
import { layerBreak, layerShell } from "../../pixelSprites/layers";
import { rand, serviceLabel, type DrawCtx } from "../common";
import { box, glow, refMap } from "./serviceKit";
import { RECYCLING_BAG_W, RECYCLING_BALER_X, RECYCLING_CUBES, RECYCLING_CUBE_GAP, RECYCLING_CUBE_W, RECYCLING_DECK, RECYCLING_GAUGE_ROWS, RECYCLING_GAUGE_TOP, RECYCLING_PILE_PITCH, RECYCLING_PILE_X0, RECYCLING_REF_H, RECYCLING_REF_W, recyclingLook } from "./recyclingLook";

/**
 * The recycling center, first ported from its Figma reference build script
 * (`_bmad-output/implementation-artifacts/pixelart-figma/build-scripts/`,
 * page 01, drawn on the retired 11 by 44 grid). Since the re-authoring, this
 * TypeScript is the canonical art, drawn through the shared `refMap` scaler.
 * It sits apart from the other service rooms in `service.ts` only to keep
 * both files under the line ceiling.
 *
 * The reference is authored on the live TILE 10 by FLOOR 45 grid
 * (`recyclingLook.ts` holds its size and the fill geometry), so `RW`/`RH` equal
 * the shipped footprint and, drawn at that footprint, `refMap` is the identity.
 * Keep it that way: off the shipped size every rect resamples, and a resampled
 * repeat (the sign letters, the belt bales, the hazard tape) loses its even
 * pitch. The gallery and preview pages hand the painters world-size boxes and
 * zoom with `ctx.scale`, so every shipped path is at the identity; the
 * off-identity guards in `serviceScale.test.ts` cover a caller that is not.
 */

// ---- Recycling --------------------------------------------------------------

/** Rooms drawn narrower than this (in screen px) leave the FULL label off. */
const FULL_LABEL_MIN_W = 44;

export function drawRecycling(d: DrawCtx, u: UnitView, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = RECYCLING_REF_W;
  const RH = RECYCLING_REF_H;
  const { F, Fu, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const H = RH;
  const deck = RECYCLING_DECK;
  // Concrete hall: walls, roof ribs, girders, and a service pipe. The full-width
  // bands stay on the edge-derived fill so they meet without a seam; the ribs,
  // studs and pipe brackets are repeated objects and take the uniform one. The
  // hall is ten bays of 20, with a rib on each bay's left edge (none on the
  // right wall, x 200).
  const ribPitch = W / 10;
  F(0, 0, W, H, "#6C6C64");
  F(0, 0, W, Math.round(H * 0.5), "#75756B");
  for (let px = 0; px < W; px += ribPitch) Fu(px, 2, 1, deck - 2, "#5A5A52");
  for (let py = 10; py < deck; py += 11) F(0, py, W, 1, "#616159");
  for (let px = 6; px < W; px += ribPitch) Fu(px, 12, 1, 1, "#8A8A80");
  F(0, 3, W, 2, "#7A8088");
  F(0, 3, W, 1, "#9AA0A8");
  // Pipe brackets on a 28px pitch from x 6. The run leaves a wider margin at
  // the right wall than the left.
  const bracketPitch = 28, brackets = Math.floor((W - 12) / bracketPitch) + 1;
  for (let b = 0; b < brackets; b++) Fu(Math.round(6 + b * bracketPitch), 2, 2, 4, "#5A6068");
  F(0, 7, W, 3, "#565C64");
  F(0, 7, W, 1, "#6A727A");
  // Compactor housing with a peek of sorted waste.
  F(7, 10, 14, 23, "#4A4E54");
  F(7, 10, 2, 23, "#5E636A");
  F(19, 10, 2, 23, "#3A3E44");
  F(9, 33, 10, 3, "#33373D");
  F(11, 35, 3, 3, "#3A4232");
  F(15, 35, 3, 3, "#4A5A3A");
  // Warm hooded work lamps over the line.
  for (const lx of [42, 136]) {
    F(lx, 10, 1, 3, "#3A3E44");
    F(lx - 3, 13, 7, 3, "#2A2E34");
    F(lx - 2, 15, 5, 1, "#F8E2B4");
    glow(F, lx, 18, "#F8E2B4");
  }
  // Overhead sorting sign. The glyph run is centered off the board width, so
  // the eleven letters keep matching margins at both ends.
  const signX = 84, signW = 63, glyphs = 11, glyphW = 3, glyphPitch = 5;
  const glyphInset = Math.round((signW - ((glyphs - 1) * glyphPitch + glyphW)) / 2);
  box(F, signX, 5, signW, 10, "#2A6E3A");
  for (let i = 0; i < glyphs; i++) Fu(signX + glyphInset + i * glyphPitch, 8, glyphW, 4, "#DCE8C0"); // sign letters
  // The shell ends; the machines, the day's pile and the plant hand are the
  // furniture. The curb and the wall gauge draw later in the routine but are
  // the hall's own, so they go on the shell (layerShell).
  layerBreak(ctx);
  // Conveyor belt carrying baled recyclables (no reserved red bale). The bale
  // run and the carried items stop at the belt's end cap, so a narrower belt
  // drops bales and items.
  const by = deck - 24;
  const beltX = 24, beltW = 109;
  const beltEnd = beltX + beltW - 2; // the end cap's left edge
  F(beltX, by, beltW, 6, "#3A3E44");
  F(beltX, by, beltW, 1, "#4E545C");
  F(beltX, by + 5, beltW, 1, "#242830");
  for (let bx = beltX + 2; bx + 3 <= beltEnd; bx += 6) Fu(bx, by + 1, 3, 4, "#2E323A"); // baled recyclables
  F(beltX - 2, by - 1, 4, 8, "#4A4E54");
  F(beltX + beltW - 2, by - 1, 4, 8, "#4A4E54");
  const items = ["#4E7A4A", "#3E6A9E", "#C8A24A", "#C87A32", "#DCDCE0", "#8C5A3A"];
  for (let ix = beltX + 4, k = 0; ix + 5 <= beltEnd; ix += 12, k++) {
    Fu(ix, by - 4, 5, 4, items[k % items.length]);
    Fu(ix, by - 4, 5, 1, "#FFFFFF", 0.22);
  }
  // Baler machine. Its vents and status lamps are inset off their own panels,
  // so each pair sits centered in the plate that carries it.
  // Width stops at the gauge channel (W - 6) so the gauge cannot paint over the
  // baler's right bevel and flatten it.
  const cx = RECYCLING_BALER_X, balerW = W - 6 - cx - 1;
  box(F, cx, by - 18, balerW, deck - (by - 18), "#7E828A");
  F(cx + 2, by - 16, 18, 14, "#5A5E66");
  F(cx + 2, by - 16, 18, 1, "#3A3E44");
  for (let k = 0; k < 2; k++) F(cx + 4 + k * 8, by - 10, 6, 4, "#3A3E44");
  box(F, cx + 23, by - 15, 15, 20, "#565C64");
  for (let k = 0; k < 2; k++) F(cx + 25 + k * 7, by - 12, 4, 4, k ? "#E85D5D" : "#3ADF6A");
  F(cx + 25, by - 6, 11, 4, "#1A1D24");
  F(cx + 26, by - 5, 9, 2, "#5FB0DC");
  // Three sorting bins.
  const bins: ReadonlyArray<readonly [string, string]> = [
    ["#3A8A4A", "#2A6E3A"],
    ["#3E6AAE", "#2A4E86"],
    ["#D8B23A", "#B08A2A"],
  ];
  const binW = 15;
  bins.forEach((c, i) => {
    const bx = 27 + i * (binW + 3);
    // One bin repeated along the deck, arrow glyph and all, so the whole
    // motif takes the uniform fill or the arrows fray bin to bin.
    box(Fu, bx, deck - 16, binW, 16, c[0]);
    Fu(bx, deck - 16, binW, 2, c[1]);
    Fu(bx + 5, deck - 19, binW - 10, 3, c[1]);
    Fu(bx + 4, deck - 11, 4, 1, "#FFFFFF", 0.85);
    Fu(bx + 7, deck - 12, 1, 3, "#FFFFFF", 0.85);
    Fu(bx + 8, deck - 8, 4, 1, "#FFFFFF", 0.85);
    Fu(bx + 8, deck - 9, 1, 2, "#FFFFFF", 0.85);
  });
  // Stacked cardboard bales.
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const bx2 = 89 + c * 17;
      const by2 = deck - 14 + r * 7;
      box(F, bx2, by2, 16, 7, "#B08A5A");
      F(bx2, by2 + 3, 16, 1, "#8A6A44");
      F(bx2 + 8, by2, 1, 7, "#7A5A38");
    }
  }
  // Compacted cubes waiting by the baler. The pile stops short of them
  // (`RECYCLING_CUBES_X` in recyclingLook.ts), so a full pile never half
  // covers a cube.
  for (let i = 0; i < RECYCLING_CUBES; i++) {
    const gx2 = cx - RECYCLING_CUBE_GAP - i * RECYCLING_CUBE_W;
    Fu(gx2, deck - 5, RECYCLING_CUBE_W, 5, i % 2 ? "#3A4232" : "#2F3628");
    Fu(gx2 + 2, deck - 6, 2, 2, "#FFFFFF", 0.28);
  }
  // Painted deck curb. The 4px stripe unit divides the hall exactly, so the
  // hazard tape ends on a whole stripe instead of a clipped sliver.
  layerShell(ctx, () => {
    F(0, deck, W, 7, "#4A4A44");
    F(0, deck, W, 1, "#5E5E56");
    for (let i = 0; i < W; i += 4) {
      Fu(i, deck + 1, 2, 2, "#D8B23A");
      Fu(i + 2, deck + 1, 2, 2, "#2A2418");
    }
    F(18, deck + 3, W - 36, 1, "#000000", 0.2);
  });
  // Live behavior: the day's waste piles up until the morning truck. The pile
  // grows rightward and stacks a second row past half full. `d.recycleFill` is
  // a prepared input, so no scan runs here; the art reads it only through
  // `recyclingLook`, which the sprite atlas steps through.
  const look = recyclingLook(d.recycleFill);
  const bags = look.bags;
  for (let i = 0; i < bags; i++) {
    const bx = RECYCLING_PILE_X0 + i * RECYCLING_PILE_PITCH;
    const jit = Math.floor(rand((u.id * 31 + i) | 0) * 3);
    F(bx, deck - 6 - jit, RECYCLING_BAG_W, 6 + jit, i % 3 === 2 ? "#4a5a3a" : "#3a4232");
    Fu(bx + 2, deck - 7 - jit, 2, 2, "#FFFFFF", 0.35);
    if (look.stacked && i % 2 === 0 && i < bags - 1) F(bx + 3, deck - 11 - jit, RECYCLING_BAG_W, 5, "#2f3628");
  }
  // Live wall gauge: green, then amber past 0.7, then red with the FULL cue at
  // capacity. The FULL red is the reserved stress color, a deliberate state cue.
  const gY = RECYCLING_GAUGE_TOP;
  const gH = RECYCLING_GAUGE_ROWS;
  let gauge = "#6bd47a";
  if (look.full) gauge = "#d6342f";
  else if (look.amber) gauge = "#e0a94e";
  const gaugeH = look.gaugeRows;
  layerShell(ctx, () => {
    F(W - 6, gY, 4, gH, "#1B2A14");
    F(W - 5, gY + gH - gaugeH, 2, gaugeH, gauge);
    // serviceLabel's last-but-one argument is the narrowest room (in screen
    // px) that still shows the label.
    if (look.full) serviceLabel(ctx, "FULL", sx(W - 31), y, "#ffd2c8", FULL_LABEL_MIN_W, w);
  });
  // The vested plant hand (shared hi-vis build with a hardhat), drawn last so
  // the worker stands in front of the pile.
  personHiVis(ctx, sx(76), sy(deck), (u.id * 7 + 3) | 0);
}
