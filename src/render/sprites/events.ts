/**
 * One-off EVENT visuals drawn in immediate mode on the sky/overlay canvases —
 * deliberately NOT Excalibur actors, so there is no actor to leak or tear down
 * (the class of bug PR #105 had to fix). Both are pure `(ctx, …)` draws the
 * TowerEngine calls each frame while an event is playing; when the play-out
 * window closes the engine simply stops calling them.
 *
 *  - {@link drawSanta}: the holiday cameo — Santa's sleigh and reindeer crossing
 *    the sky (canon: "Santa Claus and his reindeer fly across the tower").
 *  - {@link drawExplosion}: the bomb-detonation flash at the blast epicenter,
 *    a fading starburst over the rooms it guts.
 *  - {@link drawThief}: a masked thief running across a floor with a loot sack;
 *    a security guard stands behind him when he's caught.
 *  - {@link drawTreasure}: a gold sparkle + coins rising from an unearthed find.
 *  - {@link drawVipLimo}: the VIP's limousine, arriving at the lobby for a review.
 */

import { drawPerson, STAFF_LOOK } from "../pixelSprites/people";

/** One reindeer facing right: body, head, antlers, legs, a red nose. */
function drawReindeer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(x - 7 * s, y - 4 * s, 12 * s, 5 * s); // body
  ctx.fillRect(x + 4 * s, y - 8 * s, 4 * s, 5 * s); // head/neck
  // legs
  ctx.fillRect(x - 5 * s, y + 1 * s, 1.5 * s, 5 * s);
  ctx.fillRect(x + 2 * s, y + 1 * s, 1.5 * s, 5 * s);
  // antlers
  ctx.strokeStyle = "#5a3c22";
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(x + 6 * s, y - 8 * s);
  ctx.lineTo(x + 4 * s, y - 12 * s);
  ctx.moveTo(x + 7 * s, y - 8 * s);
  ctx.lineTo(x + 10 * s, y - 12 * s);
  ctx.stroke();
  // Rudolph's nose
  ctx.fillStyle = "#ff5252";
  ctx.beginPath();
  ctx.arc(x + 8 * s, y - 5 * s, 1.4 * s, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The board Santa in the sleigh seat, feet at (x, footY), sized by `s`. A
 * bespoke integer-rect port (no `person()` dependency): dark boots, a red coat
 * with edge shades, a belt and gold buckle, a fur hem, a skin face with a white
 * beard and a rosy cheek, a pom hat, and a toy sack with a poking-out gift.
 * Every rect rounds to integer device pixels after scaling. The gift is a
 * NON-reserved festive red (`#D0483E`), never the board build script's reserved
 * stress red `#C24A3A`.
 */
function drawSantaFigure(ctx: CanvasRenderingContext2D, x: number, footY: number, s: number): void {
  const px = (ax: number, ay: number, aw: number, ah: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + ax * s), Math.round(footY + ay * s), Math.max(1, Math.round(aw * s)), Math.max(1, Math.round(ah * s)));
  };
  // Toy sack behind Santa, with a gift poking out the top.
  px(-6, -11, 4, 10, "#8A5A3A");
  px(-6, -11, 4, 1, "#A06E48"); // sack highlight
  px(-5, -13, 3, 2, "#D0483E"); // festive-red gift (not the reserved stress red)
  px(-4, -13, 1, 2, "#5AA85A"); // green ribbon bit
  // Boots.
  px(0, -4, 2, 4, "#2A2A2A");
  px(4, -4, 2, 4, "#2A2A2A");
  // Red coat with edge shades.
  px(0, -13, 6, 9, "#B8342E");
  px(0, -13, 1, 9, "#8A241E");
  px(5, -13, 1, 9, "#D0483E");
  // Belt with a gold buckle.
  px(0, -8, 6, 1, "#2A2A2A");
  px(2, -8, 2, 1, "#E8C14A");
  // Fur hem + white cuffs at the coat bottom.
  px(0, -5, 6, 1, "#F4F0EC");
  px(0, -5, 1, 1, "#FFFFFF");
  px(5, -5, 1, 1, "#FFFFFF");
  // Skin face, then a white beard onto the chest and a rosy cheek.
  px(1, -17, 4, 4, "#E8C9A0");
  px(1, -14, 4, 2, "#F4F0EC");
  px(4, -15, 1, 1, "#E8B090");
  // Hat: red crown with a floppy tip, a white fur brim, and a white pom.
  px(1, -18, 4, 2, "#B8342E");
  px(-1, -18, 2, 1, "#B8342E");
  px(-2, -18, 1, 1, "#FFFFFF"); // pom
  px(1, -16, 4, 1, "#FFFFFF"); // brim
}

/**
 * Santa's sleigh + team, centered at (x, y), facing right. `scale` sizes the
 * whole rig. Drawn in screen space on the sky layer. The reindeer, sleigh, and
 * reins are the preserved canon sky rig; only the rider is the enriched board
 * figure.
 */
export function drawSanta(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
  const s = scale;
  ctx.save();
  // Rein line from the sleigh to the lead reindeer.
  ctx.strokeStyle = "rgba(120,90,60,0.85)";
  ctx.lineWidth = 1.4 * s;
  ctx.beginPath();
  ctx.moveTo(x - 20 * s, y - 2 * s);
  ctx.lineTo(x + 46 * s, y - 3 * s);
  ctx.stroke();

  // Two reindeer leading (to the right).
  drawReindeer(ctx, x + 22 * s, y, s);
  drawReindeer(ctx, x + 40 * s, y, s);

  // Sleigh body with a curled front runner.
  ctx.fillStyle = "#c0331f";
  ctx.fillRect(x - 24 * s, y - 6 * s, 22 * s, 8 * s);
  ctx.beginPath();
  ctx.moveTo(x - 2 * s, y + 2 * s);
  ctx.quadraticCurveTo(x + 6 * s, y + 2 * s, x + 4 * s, y - 5 * s); // curled prow
  ctx.lineTo(x - 2 * s, y - 5 * s);
  ctx.closePath();
  ctx.fill();
  // Gold trim + runner.
  ctx.strokeStyle = "#f0c14b";
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.moveTo(x - 26 * s, y + 3 * s);
  ctx.lineTo(x + 4 * s, y + 3 * s);
  ctx.stroke();

  // The board Santa in the sleigh seat (enriched rider; the rig above is canon).
  drawSantaFigure(ctx, x - 18 * s, y - 4 * s, s);

  ctx.restore();
}

/**
 * A bomb-blast starburst centered at (x, y), expanding to `radius`. `phase`
 * runs 0→1 over the flash's lifetime; the whole thing fades as it grows.
 */
export function drawExplosion(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, phase: number): void {
  const alpha = Math.max(0, 1 - phase);
  if (alpha <= 0 || radius <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Soft outer glow.
  ctx.fillStyle = "rgba(255,140,0,0.5)";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  // Jagged starburst.
  ctx.fillStyle = "#ffcf3a";
  const spikes = 10;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (Math.PI * i) / spikes;
    const rr = i % 2 === 0 ? radius : radius * 0.5;
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // Hot core.
  ctx.fillStyle = "#fff6d5";
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** How tall the guard and thief figures are at size 1, from the guard's
 *  alert beacon to the contact shadow under them. */
export const FIGURE_HEIGHT = 30;

/** What the overlay's figures are doing, from the event that drives them. */
export interface EventFigureState {
  /** The walk or climb frame (0 to 3), from the overlay's clock. */
  readonly frame?: number;
  /** Lit from the upper left (Modern's `rules.shadedLook`). */
  readonly lit?: boolean;
}

/** The static red alert beacon over a guard on a call (a functional cue). */
function drawBeacon(ctx: CanvasRenderingContext2D, x: number, footY: number, s: number): void {
  ctx.fillStyle = "rgba(255,64,64,0.92)";
  ctx.fillRect(Math.round(x + 4 * s), Math.round(footY - 29 * s), Math.max(1, Math.round(2 * s)), Math.max(1, Math.round(2 * s)));
}

/** A guard sweeping a floor for Classic's bomb, feet at (x, footY), sized by
 *  `s`: the cast's security guard (#2097), climbing on the emergency stairs
 *  and walking the floor's rooms. */
export function drawSearchGuard(ctx: CanvasRenderingContext2D, x: number, footY: number, s: number, climbing = false, state: EventFigureState = {}): void {
  ctx.save();
  drawPerson(ctx, x, footY, STAFF_LOOK.security, { lit: state.lit ?? false, frame: state.frame ?? 1, pose: climbing ? "climb" : "walk", scale: s });
  drawBeacon(ctx, x, footY, s);
  ctx.restore();
}

/**
 * The masked thief running rightward with a swag sack, feet at (x, y), in the
 * cast's look (#2097). When `caught`, he throws his hands up and a security
 * guard stands close behind him with an alert light. Drawn in screen space
 * on the overlay (in front of the tower).
 */
export function drawThief(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, caught = false, state: EventFigureState = {}): void {
  const s = scale;
  const lit = state.lit ?? false;
  ctx.save();
  if (caught) {
    drawPerson(ctx, x - 13 * s, y, STAFF_LOOK.security, { lit, frame: 1, pose: "stand", scale: s, empty: true });
    drawBeacon(ctx, x - 13 * s, y, s);
  }
  drawPerson(ctx, x, y, STAFF_LOOK.thief, { lit, frame: caught ? 1 : (state.frame ?? 0), pose: caught ? "caught" : "run", scale: s, empty: caught });
  ctx.restore();
}

/**
 * A gold sparkle + coins rising from an unearthed treasure, centered at (x, y).
 * `phase` runs 0→1: the sparkle grows and drifts up as it fades.
 */
export function drawTreasure(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, phase = 0): void {
  const alpha = Math.max(0, 1 - phase);
  if (alpha <= 0) return;
  const s = scale;
  const rise = phase * 12 * s;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Coins.
  ctx.fillStyle = "#f2c14e";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x + (i - 1) * 5 * s, y - rise - i * 2 * s, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Four-point sparkle.
  ctx.fillStyle = "#fff7cc";
  const cy = y - rise;
  const R = (4 + phase * 4) * s;
  const r = R * 0.38;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI * i) / 4;
    const rr = i % 2 === 0 ? R : r;
    const px = x + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A black VIP limousine facing right, its wheels resting on the line y. */
export function drawVipLimo(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
  const s = scale;
  const w = 44 * s;
  const h = 9 * s;
  ctx.save();
  // Body + cabin.
  ctx.fillStyle = "#15171c";
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillRect(x - w / 2 + 8 * s, y - h - 5 * s, w - 18 * s, 6 * s);
  // Tinted windows.
  ctx.fillStyle = "#6ea0d8";
  ctx.fillRect(x - w / 2 + 10 * s, y - h - 3.5 * s, 10 * s, 3 * s);
  ctx.fillRect(x + 2 * s, y - h - 3.5 * s, 10 * s, 3 * s);
  // Wheels with hubs.
  ctx.fillStyle = "#0a0b0e";
  for (const wx of [x - w / 2 + 9 * s, x + w / 2 - 9 * s]) {
    ctx.beginPath();
    ctx.arc(wx, y, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#cfd3da";
  for (const wx of [x - w / 2 + 9 * s, x + w / 2 - 9 * s]) {
    ctx.beginPath();
    ctx.arc(wx, y, 1.3 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Little gold pennant on the hood.
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 2 * s, y - h);
  ctx.lineTo(x + w / 2 - 2 * s, y - h - 8 * s);
  ctx.stroke();
  ctx.fillStyle = "#c9a227";
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 2 * s, y - h - 8 * s);
  ctx.lineTo(x + w / 2 + 4 * s, y - h - 6 * s);
  ctx.lineTo(x + w / 2 - 2 * s, y - h - 4 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
