import { ceilingFixture, personSeated, personStanding, roomGlow, SKIN } from "../../pixelSprites/common";
import { layerBreak, layerEnd } from "../../pixelSprites/layers";
import type { DrawCtx } from "../common";
import { FLOOR, TILE } from "../../scale";
import { box, floorb, glow, refMap, wallp, whiteCoat, type Fill } from "./serviceKit";

/**
 * In-tower service and utility facilities: security, the clinic, housekeeping,
 * and the metro station. (The recycling center lives in `recycling.ts`, the
 * basement garage in `garage.ts`, and the moving actors in `vehicles.ts`.)
 *
 * Each look was first ported from its Figma reference build script
 * (`_bmad-output/implementation-artifacts/pixelart-figma/build-scripts/`,
 * page 01, drawn on the retired 11 by 44 grid). Since the re-authoring, this
 * TypeScript is the canonical art, drawn through the shared `refMap` scaler,
 * so the tower cross-section reads as the warm, lived-in dollhouse the art
 * direction calls for. Figures are the
 * shared finalized `person()` builds, never hand-rolled. Reserved state colors
 * are never reused for decoration. These are staffed amenities: they always
 * draw their interior, never a lease or vacancy card.
 *
 * The security, clinic and housekeeping references were re-authored onto the
 * live TILE 10 by FLOOR 45 grid, so `RW`/`RH` equal the shipped footprint and, drawn at that footprint, `refMap`
 * is the identity. Keep it that way: off the shipped size every rect resamples,
 * and a resampled repeat (the monitor wall, the linen, the bottle rows) loses
 * its even pitch. Previews that draw at another size (/gallery) still resample.
 */

// ---- Security ---------------------------------------------------------------

export function drawSecurity(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 8 * TILE;
  const RH = FLOOR;
  const { F, Fu, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const fy = RH - 6;
  wallp(F, 0, 0, W, fy, "#2C3A5A", false);
  floorb(F, 0, fy, W, 6, "#242A38");
  // Two-by-five wall of green-dot camera monitors. Ten copies of one object, so
  // they take the uniform fill and a pitch that divides evenly: 7 wide on a 9
  // pitch leaves the same 2px gutter between every pair, across and down.
  const monPitch = 9;
  const monW = monPitch - 2;
  const monH = 9;
  for (let r = 0; r < 2; r++) {
    for (let cN = 0; cN < 5; cN++) {
      const mx = 6 + cN * monPitch;
      const my = 6 + r * (monH + 2);
      box(Fu, mx, my, monW, monH, "#0E1420");
      Fu(mx + 1, my + 1, monW - 2, 5, "#1A3A2A");
      Fu(mx + 1 + ((r + cN) % 3), my + 2, 1, 3, "#6bd47a", 0.8);
      Fu(mx + 1, my + 1, monW - 2, 1, "#2A4A3A");
    }
  }
  // The key rack and the red alarm light hang on the wall. They sit clear of
  // the console, the guard and the badge, so drawing them first changes no
  // pixel and keeps them on the shell.
  const rackX = 70;
  F(rackX, 8, 8, 5, "#5A4A36");
  for (let k = 0; k < 4; k++) Fu(rackX + 1 + k * 2, 13, 1, 2, "#D8B05A"); // key rack pins, one object repeated
  F(W - 8, 7, 4, 4, "#E85D5D");
  glow(F, W - 6, 9, "#FF6B6B");
  layerBreak(ctx); // the shell ends; the console, guard and badge follow
  // Console desk with a seated guard behind it.
  const deskX = 53, deskW = 24;
  box(F, deskX, fy - 8, deskW, 8, "#2A3550");
  F(deskX, fy - 8, deskW, 1, "#3E4A66");
  personSeated(ctx, sx(deskX + 8), sy(fy - 8), (Math.round(x) * 3 + 5) | 0);
  // Brass badge shield.
  F(deskX + 2, fy - 14, 6, 6, "#D8B05A");
  F(deskX + 4, fy - 13, 2, 4, "#8A6A2A");
  // A warm ceiling light over the console keys on the lit (evening) state. It
  // belongs to the shell but draws last, so it follows the furniture's end.
  layerEnd(ctx);
  ceilingFixture(ctx, x, y, w, d.lit);
}

// ---- Medical ----------------------------------------------------------------

export function drawMedical(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 16 * TILE;
  const RH = FLOOR;
  const { F, Fu, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const fy = RH - 6;
  const lamp = roomGlow(d.lit);
  wallp(F, 0, 0, W, fy, "#EDE9E2", true);
  floorb(F, 0, fy, W, 6, "#CFD6D2");
  for (let lx = 22; lx < W; lx += 40) {
    F(lx, 2, 9, 2, lamp);
    glow(F, lx + 4, 5, lamp);
  }
  // Red cross sign. Both bars are centered on the panel and all four arms
  // reach 3px past the crossing, so the cross sits straight and even.
  F(5, 8, 13, 13, "#F4F0EC");
  F(9, 9, 5, 11, "#D6342F");
  F(6, 12, 11, 5, "#D6342F");
  layerBreak(ctx); // the shell ends; the beds, equipment and staff follow
  // First curtained exam bed with a resting patient head, blanket, and rail.
  const bedW = 24;
  box(F, 25, fy - 9, bedW, 9, "#DCE2E8");
  F(25, fy - 9, bedW, 1, "#F0F4F8");
  F(27, fy - 12, 6, 3, SKIN[0]);
  F(27, fy - 13, 6, 1, "#3A2E28");
  F(32, fy - 10, 15, 3, "#BFD0DE");
  F(24, 10, 1, fy - 16, "#B8BCC0");
  F(24, 10, 25, 1, "#B8BCC0");
  F(49, 12, 4, fy - 18, "#9FC0C8", 0.6);
  // Heart monitor with a green trace.
  box(F, 58, fy - 16, 13, 10, "#20242C");
  F(60, fy - 14, 9, 6, "#0E241A");
  F(60, fy - 11, 2, 1, "#6bd47a");
  F(62, fy - 12, 1, 3, "#6bd47a");
  F(63, fy - 10, 2, 1, "#6bd47a");
  F(65, fy - 13, 1, 5, "#6bd47a");
  F(66, fy - 11, 3, 1, "#6bd47a");
  glow(F, 65, fy - 11, "#3ADF6A");
  // IV stand.
  F(55, fy - 16, 1, 16, "#B8BCC0");
  F(53, fy - 18, 5, 3, "#CFE0FF", 0.8);
  // Nurse and doctor: shared standing figures with the white-coat overlay.
  const nurseX = sx(76);
  const doctorX = sx(84);
  const foot = sy(fy);
  personStanding(ctx, nurseX, foot, (Math.round(x) * 2 + 1) | 0);
  whiteCoat(ctx, nurseX, foot);
  personStanding(ctx, doctorX, foot, (Math.round(x) * 2 + 7) | 0);
  whiteCoat(ctx, doctorX, foot);
  // Stocked supply cabinet, sized so the five bottle columns sit flush against
  // both bevels, the same at each end.
  const cabX = 95, cabW = 21;
  box(F, cabX, fy - 16, cabW, 16, "#F4F4F0");
  const bottles = ["#9FD0C8", "#E8C9A0", "#5db4e8", "#F4A0A0", "#DcE8C0"];
  // Ten copies of one bottle; /gallery is not at identity and frayed them.
  for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) Fu(cabX + 1 + k * 4, fy - 14 + r * 7, 3, 4, bottles[k]);
  F(cabX, fy - 16, cabW, 1, "#D8D8D0");
  // Wheelchair.
  F(120, fy - 8, 6, 5, "#3A4250");
  F(120, fy - 11, 5, 4, "#4A5464");
  F(120, fy - 2, 3, 3, "#1A1D24");
  F(125, fy - 3, 2, 2, "#1A1D24");
  // Second exam bed.
  box(F, 131, fy - 9, bedW, 9, "#DCE2E8");
  F(133, fy - 12, 6, 3, SKIN[1]);
  F(133, fy - 13, 6, 1, "#3A2E28");
  F(138, fy - 10, 15, 3, "#BFD0DE");
}

// ---- Housekeeping -----------------------------------------------------------

export function drawHousekeeping(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 8 * TILE;
  const RH = FLOOR;
  const { F, Fu, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const fy = RH - 6;
  wallp(F, 0, 0, W, fy, "#D8D0BE", false);
  floorb(F, 0, fy, W, 6, "#B7AE98");
  layerBreak(ctx); // the shell ends; the shelf, cart, mop and housekeeper follow
  // Linen shelf. The four stacks are placed off the carcass width, so every
  // shelf keeps the same end margin and the same gap.
  const shelfX = 4, shelfW = 27;
  box(F, shelfX, 6, shelfW, fy - 8, "#9A8468");
  const linens = ["#F4F0EC", "#CFE0FF", "#F4F0EC", "#E8D8C0"];
  for (let r = 0; r < 3; r++) {
    F(shelfX + 2, 9 + r * 8, shelfW - 4, 1, "#7A664C");
    for (let k = 0; k < 4; k++) Fu(shelfX + 2 + k * 6, 10 + r * 8, 5, 5, linens[(k + r) % 4]);
  }
  // Teal supply cart with towels and spray bottles, plus its wheels.
  const cartX = 40, cartW = 18;
  box(F, cartX, fy - 10, cartW, 8, "#3E8E8E");
  for (let k = 0; k < 2; k++) F(cartX + 2 + k * 6, fy - 14, 5, 4, k ? "#CFE0FF" : "#F4F0EC");
  for (let k = 0; k < 2; k++) F(cartX + 12 + k * 3, fy - 13, 2, 3, k ? "#5db4e8" : "#E85D5D");
  F(cartX, fy - 2, 2, 2, "#1A1D24");
  F(cartX + cartW - 2, fy - 2, 2, 2, "#1A1D24");
  // Mop and bucket. The towel rack drawn next covers them entirely, as it did
  // before the re-authoring; the approved composition keeps that on purpose,
  // since revealing them would add an object to the room.
  F(62, fy - 14, 1, 12, "#8A5A30");
  F(60, fy - 16, 5, 3, "#E8E0B0");
  box(F, 60, fy - 6, 6, 6, "#F4C020");
  F(60, fy - 6, 6, 2, "#CFE0FF", 0.6);
  // Towel rack: four bars on a 3px pitch leave 2px reveals between them and
  // 2px inside each end, the carcass bevel included.
  const rackX = W - 20, rackW = 14;
  box(F, rackX, fy - 9, rackW, 9, "#B8A47E");
  for (let k = 0; k < 4; k++) F(rackX + 2 + k * 3, fy - 9, 1, 9, "#9A8460");
  F(rackX + 2, fy - 11, 10, 3, "#F4F0EC");
  // Standing housekeeper by the cart (the teal cart carries the uniform read).
  personStanding(ctx, sx(35), sy(fy), (Math.round(x) * 3 + 3) | 0);
  layerEnd(ctx); // the ceiling light belongs to the shell but draws last
  ceilingFixture(ctx, x, y, w, d.lit);
}

// ---- Metro ------------------------------------------------------------------

export function drawMetro(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  // The metro spans the whole lot, so the station is width-responsive: the
  // ceiling, wall tiles, pillars, posters, benches, and deck tile across the
  // real width while the signage stays centered. The composition is the
  // party-ratified high platform: a double-height concourse over a one-story
  // track trough, with the platform deck on the MIDDLE story's floor line,
  // exactly where the crowd system stands routed commuters (their platform
  // floor is the unit's middle story). The train (drawMetroTrain, its own
  // actor) rides the trough and slides in front of the far-platform scene;
  // waiting commuters draw in front of it on the near edge. The platform
  // itself draws EMPTY: real routed commuters are the crowd, so an empty
  // tower honestly shows an empty platform (no ghost crowd).
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  const f: Fill = (px, py, pw, ph, color, alpha = 1) => {
    // Clip every rect to the unit box. In-game the bake canvas is exactly
    // W x H so this changes nothing, but the gallery paints entries onto one
    // shared canvas, where the fixed-y furniture on its (deliberately
    // squished) metro cell would otherwise bleed into the neighboring cells.
    // A clipped-to-zero (or negative) size paints nothing, matching refMap's
    // zero-size guard, rather than promoting an empty rect into a stray pixel.
    const x0 = Math.max(0, Math.round(px));
    const y0 = Math.max(0, Math.round(py));
    const x1 = Math.min(W, Math.round(px + pw));
    const y1 = Math.min(H, Math.round(py + ph));
    if (x1 <= x0 || y1 <= y0) return;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x) + x0, Math.round(y) + y0, x1 - x0, y1 - y0);
    if (alpha !== prevAlpha) ctx.globalAlpha = prevAlpha;
  };
  const deckY = Math.round(H * (2 / 3)); // platform deck = middle story's floor line
  const lamp = roomGlow(d.lit);
  // Warm ivory tiled back wall across the double-height concourse.
  f(0, 0, W, deckY, "#D8CFB8");
  f(0, 8, W, 1, "#E6DEC8"); // bright course under the vault
  for (let px = 0; px < W; px += 10) f(px, 8, 1, deckY - 8, "#C4BAA2");
  for (let py = 16; py < deckY - 4; py += 8) f(0, py, W, 1, "#C4BAA2");
  // Vaulted ceiling: dark steel band with arch ribs and hanging twin-globe
  // lamps (warm when lit).
  f(0, 0, W, 8, "#2E3038");
  for (let ax = 0; ax < W; ax += 40) {
    f(ax, 6, 38, 1, "#3A3D48");
    f(ax + 18, 0, 2, 8, "#3A3D48");
  }
  for (let lx = 30; lx + 8 < W; lx += 92) {
    f(lx + 3, 8, 1, 4, "#3A3D48"); // stem
    f(lx, 12, 7, 3, lamp);
    glow(f, lx + 3, 14, lamp);
  }
  // The line-color band: a red stripe with white trim running the full width.
  f(0, 24, W, 1, "#F0EAD8");
  f(0, 25, W, 3, "#C0392B");
  f(0, 28, W, 1, "#F0EAD8");
  // Teal tiled pillars on the reference cadence, with edge light and plinth.
  for (let px = 70; px < W - 20; px += 105) {
    f(px, 8, 11, deckY - 8, "#2E5850");
    f(px, 8, 2, deckY - 8, "#3E6E64");
    f(px + 9, 8, 2, deckY - 8, "#1F423C");
    f(px - 1, deckY - 6, 13, 6, "#23343A"); // plinth
    for (let py = 16; py < deckY - 8; py += 9) f(px + 2, py, 7, 1, "#264A44");
  }
  // Backlit ad posters between the pillars, three designs on rotation: a
  // sunset travel ad, a soda ad, and a show bill. Color varies second,
  // geometry first (per the art bible), and none reuses a state literal.
  let poster = 0;
  for (let px = 122; px + 18 < W - 20; px += 105, poster++) {
    box(f, px, 34, 18, 24, "#20242C");
    f(px + 1, 35, 16, 1, d.lit ? "#F0EAD8" : "#6E6A5E"); // backlight rim
    if (poster % 3 === 0) {
      f(px + 2, 37, 14, 12, "#E08A4A"); // sunset sky
      f(px + 2, 45, 14, 4, "#B05A32");
      f(px + 5, 40, 5, 5, "#F4D06A"); // sun
      f(px + 2, 49, 14, 7, "#3A3330"); // skyline silhouette
      f(px + 5, 47, 2, 4, "#3A3330");
      f(px + 11, 46, 2, 5, "#3A3330");
    } else if (poster % 3 === 1) {
      f(px + 2, 37, 14, 19, "#3E6E9E"); // soda blue
      f(px + 5, 40, 8, 10, "#E8E4D8"); // bottle
      f(px + 7, 38, 4, 3, "#E8E4D8");
      f(px + 6, 43, 6, 3, "#C0392B"); // label
      f(px + 3, 52, 12, 1, "#E8E4D8"); // script line
    } else {
      f(px + 2, 37, 14, 19, "#6E4E86"); // show-bill purple
      f(px + 8, 41, 2, 6, "#F4D06A"); // starburst
      f(px + 6, 43, 6, 2, "#F4D06A");
      f(px + 5, 40, 1, 1, "#F4D06A");
      f(px + 12, 40, 1, 1, "#F4D06A");
      f(px + 4, 52, 10, 1, "#E8E4D8"); // title line
    }
  }
  // Centered METRO sign with the red M roundel, hung from the vault.
  const mid = Math.round(W / 2);
  f(mid - 28, 8, 2, 6, "#3A3D48");
  f(mid + 26, 8, 2, 6, "#3A3D48");
  box(f, mid - 30, 14, 60, 14, "#1E4E86");
  for (let i = 0; i < 8; i++) f(mid - 24 + i * 6, 18, 3, 6, "#DCE6F0");
  f(mid - 46, 14, 14, 14, "#C0392B");
  f(mid - 42, 18, 6, 6, "#FFFFFF");
  f(mid - 41, 19, 1, 4, "#C0392B");
  f(mid - 39, 19, 1, 4, "#C0392B");
  f(mid - 37, 19, 1, 4, "#C0392B");
  // Station clock beside the sign.
  box(f, mid + 40, 16, 10, 10, "#20242C");
  f(mid + 42, 18, 6, 6, "#F0EAD8");
  f(mid + 44, 19, 1, 3, "#20242C");
  f(mid + 45, 21, 2, 1, "#20242C");
  // Lit route-map board near the left end.
  box(f, 20, 34, 52, 26, "#20303E");
  f(24, 38, 44, 2, "#5FB0DC");
  f(24, 44, 32, 1, "#E8C14A");
  f(24, 48, 38, 1, "#6bd47a");
  for (let i = 0; i < 6; i++) f(26 + i * 7, 40, 2, 2, "#F4F0E4");
  layerBreak(ctx); // the shell ends; the benches, vending machines and bins follow
  // Deck furniture on the far platform: wooden benches, a vending machine on
  // a longer cadence, and a bin. The train slides in FRONT of these.
  for (let bx = 110; bx < W - 24; bx += 100) {
    box(f, bx, deckY - 8, 22, 8, "#6A5240");
    f(bx + 1, deckY - 8, 20, 1, "#7A6250");
    f(bx + 2, deckY - 4, 2, 4, "#4A3A2E");
    f(bx + 18, deckY - 4, 2, 4, "#4A3A2E");
  }
  for (let vx = 160; vx + 12 < W - 24; vx += 210) {
    box(f, vx, deckY - 18, 12, 18, "#B04438");
    f(vx + 2, deckY - 16, 8, 9, d.lit ? "#FFE9B0" : "#6E5A4E"); // lit face
    for (let r = 0; r < 3; r++) f(vx + 3, deckY - 15 + r * 3, 6, 1, "#B04438");
    f(vx + 2, deckY - 5, 8, 3, "#3A3330"); // dispense tray
  }
  for (let tx = 86; tx < W - 24; tx += 200) {
    f(tx, deckY - 6, 6, 6, "#4E5A50");
    f(tx + 1, deckY - 6, 4, 1, "#2E3A30");
  }
  // The furniture ends here: the exit stairs, the deck and the trough are
  // structure drawn over it, so the depth layers put them on the shell.
  layerEnd(ctx);
  // WAY OUT at the right end: green sign over stair steps rising out of frame.
  const ex = W - 46;
  box(f, ex, 30, 26, 10, "#3E7E4E");
  for (let i = 0; i < 4; i++) f(ex + 3 + i * 5, 33, 3, 4, "#E8F4E8");
  f(ex + 22, 34, 2, 2, "#E8F4E8"); // arrow head
  for (let s = 0; s < 5; s++) f(ex + 2 + s * 5, deckY - 3 - s * 3, W - ex, 3, "#B8AE96");
  // The platform deck: light concrete edge, yellow tactile strip, slab face.
  f(0, deckY, W, 1, "#D8D4C8");
  f(0, deckY + 1, W, 1, "#E8C14A");
  f(0, deckY + 2, W, 2, "#caa84a");
  f(0, deckY + 4, W, 4, "#8A8578");
  f(0, deckY + 8, W, 2, "#6E6A5E");
  // The trough: retaining wall with cable conduits and maintenance doors,
  // grime under the deck lip, and the track bed the train rides.
  const troughY = deckY + 10;
  f(0, troughY, W, H - troughY, "#3A4046");
  f(0, troughY, W, 3, "#2E3238", 0.9); // shadow under the lip
  f(0, troughY + 8, W, 2, "#2A2E34"); // cable conduits
  f(0, troughY + 14, W, 1, "#2A2E34");
  for (let cxp = 24; cxp < W; cxp += 48) f(cxp, troughY + 7, 2, 9, "#22262C"); // clips
  for (let mx = 240; mx + 14 < W; mx += 480) {
    box(f, mx, troughY + 4, 14, H - troughY - 12, "#303640");
    f(mx + 10, troughY + 12, 2, 2, "#5A5E66"); // handle
  }
  // Track bed: ballast, sleepers, running rails, and the third rail.
  f(0, H - 8, W, 8, "#26282E");
  for (let sxp = 4; sxp < W; sxp += 10) f(sxp, H - 7, 3, 6, "#1C1E24");
  f(0, H - 6, W, 2, "#6E7686");
  f(0, H - 6, W, 1, "#9AA2B0");
  f(0, H - 2, W, 2, "#6E7686");
  for (let tr = 16; tr < W; tr += 64) f(tr, H - 10, 8, 2, "#50565E"); // third rail
}
